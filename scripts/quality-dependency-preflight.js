#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parse: parseJsonc, printParseErrorCode } = require("jsonc-parser");
const { parseSyml } = require("@yarnpkg/parsers");
const { ZipFS } = require("@yarnpkg/libzip");
const { parseAllDocuments, parseDocument } = require("yaml");
const { parse: parseToml } = require("smol-toml");

const SUPPORTED_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_DEPTH = 128;
const MAX_NODES = 1_000_000;
const MAX_ZIP_ENTRIES = 50_000;
const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024;

function readJson(file, label) {
  try {
    const value = JSON.parse(readText(file, label));
    validateObjectLimits(value, label);
    return value;
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`, {
      cause: error,
    });
  }
}

function validateObjectLimits(value, label) {
  const stack = [{ value, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (
      current.value === null ||
      typeof current.value !== "object" ||
      seen.has(current.value)
    ) {
      continue;
    }
    if (current.depth > MAX_DEPTH) {
      throw new Error(`${label} exceeds ${MAX_DEPTH} levels`);
    }
    seen.add(current.value);
    nodes += 1;
    if (nodes > MAX_NODES) {
      throw new Error(`${label} exceeds ${MAX_NODES} nodes`);
    }
    for (const child of Object.values(current.value)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function readBuffer(file, label) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("must be a regular non-symlink file");
    }
    if (stat.size > MAX_FILE_BYTES) throw new Error("exceeds 256 MiB");
    const descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    try {
      const before = fs.fstatSync(descriptor);
      const data = fs.readFileSync(descriptor);
      const after = fs.fstatSync(descriptor);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      ) {
        throw new Error("changed while being read");
      }
      return data;
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`, {
      cause: error,
    });
  }
}

function readText(file, label) {
  return readBuffer(file, label).toString("utf8");
}

function parseYaml(text, label) {
  const document = parseDocument(text, {
    maxAliasCount: 100,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`${label} is malformed: ${document.errors[0].message}`);
  }
  const value = document.toJS({ maxAliasCount: 100 });
  validateObjectLimits(value, label);
  return value;
}

function directDependencies(pkg) {
  return Object.keys({
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  }).sort();
}

function dependencySpecs(pkg) {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
}

function packageBinEntries(name, pkg) {
  if (typeof pkg.bin === "string") return [[name.split("/").at(-1), pkg.bin]];
  if (!pkg.bin || typeof pkg.bin !== "object") return [];
  return Object.entries(pkg.bin);
}

function exactVersion(value) {
  const core = String(value).split(/[+-]/, 1)[0];
  const parts = core.split(".");
  return (
    parts.length === 3 &&
    parts.every(
      (part) =>
        part !== "" && [...part].every((char) => char >= "0" && char <= "9"),
    )
  );
}

function packageManager(root, pkg) {
  const present = {
    npm: fs.existsSync(path.join(root, "package-lock.json")),
    pnpm: fs.existsSync(path.join(root, "pnpm-lock.yaml")),
    yarn: fs.existsSync(path.join(root, "yarn.lock")),
    bun:
      fs.existsSync(path.join(root, "bun.lock")) ||
      fs.existsSync(path.join(root, "bun.lockb")),
  };
  if (pkg.packageManager !== undefined) {
    const declaration = String(pkg.packageManager);
    const separator = declaration.indexOf("@");
    const declared = declaration.slice(0, separator);
    const version = declaration.slice(separator + 1);
    if (
      separator < 1 ||
      !SUPPORTED_MANAGERS.includes(declared) ||
      !exactVersion(version)
    ) {
      throw new Error(
        "packageManager must be <npm|pnpm|yarn|bun>@<exact-version>",
      );
    }
    if (!present[declared]) {
      throw new Error(`${declared}: declared lockfile is missing`);
    }
    return declared;
  }
  const candidates = SUPPORTED_MANAGERS.filter((manager) => present[manager]);
  if (candidates.length !== 1) {
    throw new Error(
      `package manager is ${candidates.length === 0 ? "missing" : `ambiguous (${candidates.join(", ")})`}; add an exact packageManager declaration`,
    );
  }
  return candidates[0];
}

function npmLockedIdentity(lock, name) {
  const relative = `node_modules/${name}`;
  const record = lock.packages?.[relative];
  if (typeof record?.version === "string") {
    return { version: record.version, target: null };
  }
  if (record?.link === true && typeof record.resolved === "string") {
    const target = lock.packages?.[record.resolved];
    if (typeof target?.version === "string") {
      return { version: target.version, target: record.resolved };
    }
  }
  const legacy = lock.dependencies?.[name];
  return typeof legacy?.version === "string"
    ? { version: legacy.version, target: null }
    : null;
}

function isSubpath(parent, candidate, pathApi = path) {
  const relative = pathApi.relative(parent, candidate);
  return (
    relative === "" ||
    (!pathApi.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`))
  );
}

function containedRealpath(root, candidate, label) {
  const resolvedRoot = fs.realpathSync(root);
  const resolved = fs.realpathSync(candidate);
  if (!isSubpath(resolvedRoot, resolved)) {
    throw new Error(`${label} escapes the repository`);
  }
  return resolved;
}

function validateInstalled(
  root,
  name,
  expectedVersion,
  packageRoot,
  { expectedName = name, checkCommandLinks = true } = {},
) {
  const failures = [];
  if (!fs.existsSync(packageRoot)) return [`${name}: package is not installed`];
  try {
    const resolvedRoot = containedRealpath(
      root,
      packageRoot,
      `${name} package`,
    );
    const installed = readJson(
      path.join(resolvedRoot, "package.json"),
      `${name} package.json`,
    );
    if (installed.name !== expectedName) {
      failures.push(
        `${name}: installed package is named ${installed.name || "missing"}, lockfile requires ${expectedName}`,
      );
    } else if (installed.version !== expectedVersion) {
      failures.push(
        `${name}: installed ${installed.version || "unknown"}, lockfile requires ${expectedVersion}`,
      );
    }
    for (const [bin, relativeTarget] of packageBinEntries(
      expectedName,
      installed,
    )) {
      const target = containedRealpath(
        root,
        path.resolve(resolvedRoot, relativeTarget),
        `${name} bin ${bin}`,
      );
      if (!isSubpath(resolvedRoot, target)) {
        failures.push(`${name}: declared bin ${bin} escapes its package`);
        continue;
      }
      if (!checkCommandLinks) continue;
      const command = path.join(root, "node_modules", ".bin", bin);
      if (!fs.existsSync(command)) {
        failures.push(`${name}: package-local executable ${bin} is missing`);
        continue;
      }
      const commandStat = fs.lstatSync(command);
      if (
        commandStat.isSymbolicLink() &&
        containedRealpath(root, command, `${name} executable ${bin}`) !== target
      ) {
        failures.push(`${name}: executable ${bin} targets the wrong file`);
      }
    }
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
  return failures;
}

function validateLocalInstall(root, name, localRoot, expectedVersion) {
  const installedRoot = path.join(root, "node_modules", name);
  if (!fs.existsSync(installedRoot))
    return [`${name}: package is not installed`];
  try {
    const resolvedLocal = containedRealpath(
      root,
      localRoot,
      `${name} local package`,
    );
    const resolvedInstalled = containedRealpath(
      root,
      installedRoot,
      `${name} installed package`,
    );
    if (resolvedInstalled !== resolvedLocal) {
      return [`${name}: installed link does not match the locked local target`];
    }
    return validateInstalled(root, name, expectedVersion, installedRoot);
  } catch (error) {
    return [`${name}: ${error.message}`];
  }
}

function pnpmPackageIdentity(name, selected) {
  if (!selected.startsWith("npm:"))
    return { name, depPath: `${name}@${selected}` };
  const identity = selected.slice("npm:".length);
  const separator = identity.lastIndexOf("@");
  if (separator <= 0) return { name, depPath: `${name}@${selected}` };
  return {
    name: identity.slice(0, separator),
    depPath: identity,
  };
}

function pnpmDepPathFilename(depPath, maxLength = 120) {
  let value = depPath;
  const separator = value.indexOf("@", 1);
  if (!value.startsWith("file:") && separator !== -1) {
    value = `${value.slice(0, separator)}@${value.slice(separator + 1)}`;
  } else if (value.startsWith("file:")) {
    value = value.replace(":", "+");
  }
  value = [...value]
    .map((char) => ('\\/:*?"<>|#'.includes(char) ? "+" : char))
    .join("");
  if (value.includes("(")) {
    value = value
      .replace(/\)$/u, "")
      .replaceAll(")(", "_")
      .replaceAll("(", "_")
      .replaceAll(")", "_");
  }
  if (
    value.length > maxLength ||
    (value !== value.toLowerCase() && !value.startsWith("file+"))
  ) {
    const hash = crypto
      .createHash("sha256")
      .update(value)
      .digest("hex")
      .slice(0, 32);
    return `${value.slice(0, maxLength - 33)}_${hash}`;
  }
  return value;
}

function containedPath(root, candidate) {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedCandidate = fs.existsSync(candidate)
    ? fs.realpathSync(candidate)
    : path.resolve(candidate);
  return isSubpath(resolvedRoot, resolvedCandidate);
}

function shimNodePath(text) {
  const line = text
    .split("\n")
    .find((candidate) => candidate.startsWith("  export NODE_PATH="));
  if (!line) return [];
  const quoted = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
  const value = quoted.endsWith(":$NODE_PATH")
    ? quoted.slice(0, -":$NODE_PATH".length)
    : quoted;
  return value ? value.split(":") : [];
}

async function expectedCommandFiles(target, command, nodePath) {
  const writes = new Map();
  const memoryFs = {
    promises: {
      chmod: async () => {},
      mkdir: async () => {},
      readFile: async (file, encoding) => {
        const bytes = readBuffer(file, `${path.basename(file)} command target`);
        return encoding ? bytes.toString(encoding) : bytes;
      },
      stat: async (file) => fs.statSync(file),
      unlink: async () => {},
      writeFile: async (file, data) => {
        writes.set(file, String(data));
      },
    },
  };
  const { cmdShim } = await import("@zkochan/cmd-shim");
  await cmdShim(target, command, {
    createCmdFile:
      process.platform === "win32" || fs.existsSync(`${command}.cmd`),
    createPwshFile:
      process.platform === "win32" || fs.existsSync(`${command}.ps1`),
    fs: memoryFs,
    nodePath,
  });
  return writes;
}

async function validateCommandGroup(root, command, target, name) {
  const stat = fs.lstatSync(command);
  if (stat.isSymbolicLink()) {
    return containedRealpath(root, command, `${name} executable`) === target
      ? []
      : [`${name}: executable targets the wrong file`];
  }
  const text = readText(command, `${name} executable`);
  const marker = `# cmd-shim-target=${target.replaceAll("\\", "/")}\n`;
  if (!text.endsWith(marker)) {
    return [`${name}: regular executable has no exact target marker`];
  }
  const nodePath = shimNodePath(text);
  for (const entry of nodePath) {
    if (!containedPath(root, entry)) {
      return [`${name}: executable NODE_PATH escapes the repository`];
    }
  }
  const expected = await expectedCommandFiles(target, command, nodePath);
  const failures = [];
  for (const [file, content] of expected) {
    if (!fs.existsSync(file)) {
      failures.push(
        `${name}: command wrapper ${path.extname(file) || "POSIX"} is missing`,
      );
    } else if (readText(file, `${name} command wrapper`) !== content) {
      failures.push(
        `${name}: command wrapper ${path.extname(file) || "POSIX"} differs from the supported template`,
      );
    }
  }
  return failures;
}

function declaredCommandTarget(root, commandName, target) {
  const resolvedRoot = fs.realpathSync(root);
  let cursor = path.dirname(target);
  while (containedPath(resolvedRoot, cursor)) {
    const manifest = path.join(cursor, "package.json");
    if (fs.existsSync(manifest)) {
      const pkg = readJson(manifest, `${commandName} owner package.json`);
      if (
        packageBinEntries(pkg.name || "", pkg).some(
          ([name, relative]) =>
            name === commandName && path.resolve(cursor, relative) === target,
        )
      ) {
        return true;
      }
    }
    if (cursor === resolvedRoot) break;
    cursor = path.dirname(cursor);
  }
  return false;
}

async function validateBinDirectory(root) {
  const binRoot = path.join(root, "node_modules", ".bin");
  if (!fs.existsSync(binRoot)) return [];
  const failures = [];
  const entries = fs.readdirSync(binRoot);
  for (const entry of entries) {
    if (entry.endsWith(".cmd") || entry.endsWith(".ps1")) continue;
    const command = path.join(binRoot, entry);
    const stat = fs.lstatSync(command);
    let target;
    if (stat.isSymbolicLink()) {
      target = containedRealpath(root, command, `${entry} executable`);
    } else {
      const text = readText(command, `${entry} executable`);
      const marker = text.trimEnd().split("\n").at(-1);
      if (!marker.startsWith("# cmd-shim-target=")) {
        failures.push(
          `${entry}: regular executable has no exact target marker`,
        );
        continue;
      }
      target = containedRealpath(
        root,
        marker.slice("# cmd-shim-target=".length),
        `${entry} target`,
      );
      failures.push(
        ...(await validateCommandGroup(root, command, target, entry)),
      );
    }
    if (!declaredCommandTarget(root, entry, target)) {
      failures.push(
        `${entry}: executable is not declared by its target package`,
      );
    }
  }
  for (const entry of entries.filter(
    (candidate) => candidate.endsWith(".cmd") || candidate.endsWith(".ps1"),
  )) {
    const base = entry.endsWith(".cmd")
      ? entry.slice(0, -4)
      : entry.slice(0, -4);
    if (!entries.includes(base))
      failures.push(`${entry}: command wrapper has no base shim`);
  }
  return failures;
}

function pnpmSelection(lock, name) {
  const importer = lock.importers?.["."];
  return {
    ...(importer?.dependencies || {}),
    ...(importer?.devDependencies || {}),
  }[name];
}

function inspectPnpm(root, dependencies, specs) {
  const text = readText(path.join(root, "pnpm-lock.yaml"), "pnpm-lock.yaml");
  const documents = parseAllDocuments(text, {
    maxAliasCount: 100,
    uniqueKeys: true,
  });
  if (![1, 2].includes(documents.length)) {
    return [
      "pnpm: lockfile must contain one project document or one environment plus one project document",
    ];
  }
  if (documents.some((document) => document.errors.length > 0)) {
    return [`pnpm: malformed lockfile (${documents[0].errors[0]?.message})`];
  }
  const locks = documents.map((document) =>
    document.toJS({ maxAliasCount: 100 }),
  );
  for (const lock of locks) validateObjectLimits(lock, "pnpm-lock.yaml");
  if (locks.some((lock) => String(lock?.lockfileVersion) !== "9.0")) {
    return ["pnpm: unsupported lockfile schema"];
  }
  if (locks.length === 2 && !locks[0]?.importers?.["."]?.configDependencies) {
    return ["pnpm: first document is not an environment lockfile"];
  }
  const lock = locks.at(-1);
  if (!lock?.importers?.["."]) return ["pnpm: root importer is missing"];
  const failures = [];
  for (const name of dependencies) {
    const selection = pnpmSelection(lock, name);
    if (selection?.specifier !== specs[name]) {
      failures.push(
        `${name}: package.json requires ${specs[name]}, pnpm-lock records ${selection?.specifier || "missing"}`,
      );
      continue;
    }
    const selected = String(selection.version || "");
    if (!selected) {
      failures.push(`${name}: missing pnpm lock selection`);
      continue;
    }
    if (/^(?:link|file):/.test(selected)) {
      const packageRoot = path.resolve(
        root,
        selected.replace(/^(?:link|file):/, ""),
      );
      try {
        const local = readJson(
          path.join(
            containedRealpath(root, packageRoot, `${name} local package`),
            "package.json",
          ),
          `${name} package.json`,
        );
        failures.push(
          ...validateLocalInstall(root, name, packageRoot, local.version),
        );
      } catch (error) {
        failures.push(error.message);
      }
      continue;
    }
    const identity = pnpmPackageIdentity(name, selected);
    const packageKey = identity.depPath.split("(", 1)[0];
    const packageRecord = lock.packages?.[packageKey];
    const snapshotRecord = lock.snapshots?.[identity.depPath];
    if (
      !packageRecord ||
      typeof packageRecord !== "object" ||
      !snapshotRecord ||
      typeof snapshotRecord !== "object" ||
      typeof packageRecord.resolution?.integrity !== "string" ||
      packageRecord.resolution.integrity.length === 0
    ) {
      failures.push(
        `${name}: pnpm package graph does not bind ${identity.depPath}`,
      );
      continue;
    }
    const version = identity.depPath
      .slice(identity.depPath.lastIndexOf("@") + 1)
      .split("(")[0];
    const modulesFile = path.join(root, "node_modules", ".modules.yaml");
    const modules = fs.existsSync(modulesFile)
      ? parseYaml(
          readText(modulesFile, "pnpm modules state"),
          "pnpm modules state",
        )
      : {};
    const expectedRoot = path.join(
      root,
      "node_modules",
      ".pnpm",
      pnpmDepPathFilename(
        identity.depPath,
        modules.virtualStoreDirMaxLength || 120,
      ),
      "node_modules",
      identity.name,
    );
    try {
      if (
        containedRealpath(
          root,
          path.join(root, "node_modules", name),
          `${name} package`,
        ) !== containedRealpath(root, expectedRoot, `${name} locked package`)
      ) {
        failures.push(
          `${name}: installed pnpm locator does not match ${identity.depPath}`,
        );
        continue;
      }
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      continue;
    }
    failures.push(
      ...validateInstalled(
        root,
        name,
        version,
        path.join(root, "node_modules", name),
        { expectedName: identity.name },
      ),
    );
  }
  return failures;
}

function yarnRootRecord(lock, pkg) {
  const resolution = `${pkg.name}@workspace:.`;
  return (
    lock[resolution] ||
    Object.values(lock).find((record) => record?.resolution === resolution)
  );
}

function yarnSelectedRecord(lock, name, selector) {
  const exact = `${name}@${selector}`;
  const keys = Object.keys(lock).filter((key) =>
    key.split(/,\s*/).includes(exact),
  );
  return keys.length === 1 ? lock[keys[0]] : null;
}

function yarnLocatorSlug(name, reference) {
  const scopeSeparator = name.startsWith("@") ? name.indexOf("/") : -1;
  const scope = scopeSeparator === -1 ? null : name.slice(1, scopeSeparator);
  const bareName =
    scopeSeparator === -1 ? name : name.slice(scopeSeparator + 1);
  const identHash = crypto
    .createHash("sha512")
    .update(`${scope || ""}${bareName}`)
    .digest("hex");
  const locatorHash = crypto
    .createHash("sha512")
    .update(`${identHash}${reference}`)
    .digest("hex");
  const colon = reference.indexOf(":");
  const protocol = colon === -1 ? "exotic" : reference.slice(0, colon);
  const selector = colon === -1 ? reference : reference.slice(colon + 1);
  const humanReference = exactVersion(selector)
    ? `${protocol}-${selector}`
    : protocol;
  const ident = scope === null ? bareName : `@${scope}-${bareName}`;
  return `${ident}-${humanReference}-${locatorHash.slice(0, 10)}`;
}

function inspectYarn(root, pkg, dependencies, specs) {
  let lock;
  try {
    lock = parseSyml(readText(path.join(root, "yarn.lock"), "yarn.lock"));
    validateObjectLimits(lock, "yarn.lock");
  } catch (error) {
    return [`yarn.lock is malformed: ${error.message}`];
  }
  if (![8, 9, 10].includes(Number(lock.__metadata?.version))) {
    return [
      `yarn: unsupported lock schema ${lock.__metadata?.version || "missing"}`,
    ];
  }
  const rootRecord = yarnRootRecord(lock, pkg);
  if (!rootRecord) return ["yarn: root workspace record is missing"];
  const configFile = path.join(root, ".yarnrc.yml");
  const config = fs.existsSync(configFile)
    ? parseYaml(readText(configFile, ".yarnrc.yml"), ".yarnrc.yml")
    : {};
  const linker = config.nodeLinker || "pnp";
  if (linker === "pnp") {
    if (!fs.existsSync(path.join(root, ".pnp.data.json"))) {
      return [
        "yarn: inline PnP is unsupported; set pnpEnableInlining: false and run yarn install --immutable",
      ];
    }
    return inspectYarnPnp(root, rootRecord, lock, dependencies, specs);
  }
  if (!["node-modules", "pnpm"].includes(linker)) {
    return [`yarn: unsupported linker ${linker}`];
  }
  let state = null;
  if (linker === "node-modules") {
    const stateFile = path.join(root, "node_modules", ".yarn-state.yml");
    if (!fs.existsSync(stateFile)) {
      return ["yarn: node_modules/.yarn-state.yml is missing"];
    }
    state = parseYaml(readText(stateFile, "Yarn state"), "Yarn state");
    if (Number(state.__metadata?.version) !== 1) {
      return [
        `yarn: unsupported install-state schema ${state.__metadata?.version || "missing"}`,
      ];
    }
  }
  const packageMap =
    linker === "pnpm"
      ? readJson(
          path.join(root, "node_modules", ".package-map.json"),
          "Yarn package map",
        )
      : null;
  const failures = [];
  for (const name of dependencies) {
    const selector = rootRecord.dependencies?.[name];
    if (String(selector || "").replace(/^npm:/, "") !== specs[name]) {
      failures.push(
        `${name}: package.json requires ${specs[name]}, yarn.lock records ${selector || "missing"}`,
      );
      continue;
    }
    const record = yarnSelectedRecord(lock, name, selector);
    if (!record) {
      failures.push(`${name}: yarn.lock selection is ambiguous or missing`);
      continue;
    }
    if (
      linker === "node-modules" &&
      !state[record.resolution]?.locations?.includes(`node_modules/${name}`)
    ) {
      failures.push(`${name}: Yarn install state does not bind yarn.lock`);
      continue;
    }
    const packageRoot =
      linker === "pnpm"
        ? path.join(
            root,
            "node_modules",
            packageMap?.packages?.["."]?.dependencies?.[name] || "",
          )
        : path.join(root, "node_modules", name);
    if (linker === "pnpm") {
      const reference = record.resolution.slice(`${name}@`.length);
      const expectedMap = `.store/${yarnLocatorSlug(name, reference)}/package`;
      const mapped = packageMap?.packages?.["."]?.dependencies?.[name];
      if (mapped !== expectedMap) {
        failures.push(
          `${name}: Yarn package map does not bind ${record.resolution}`,
        );
        continue;
      }
      try {
        if (
          containedRealpath(
            root,
            path.join(root, "node_modules", name),
            `${name} package`,
          ) !== containedRealpath(root, packageRoot, `${name} mapped package`)
        ) {
          failures.push(
            `${name}: Yarn package link does not match package map`,
          );
          continue;
        }
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        continue;
      }
    }
    failures.push(
      ...validateInstalled(root, name, record.version, packageRoot),
    );
  }
  return failures;
}

function inspectYarnPnp(root, rootRecord, lock, dependencies, specs) {
  const data = readJson(path.join(root, ".pnp.data.json"), ".pnp.data.json");
  const rootLocator = data.dependencyTreeRoots?.[0];
  const registry = new Map(
    (data.packageRegistryData || []).map(([name, references]) => [
      name,
      new Map(references),
    ]),
  );
  const rootInfo = registry.get(rootLocator?.name)?.get(rootLocator?.reference);
  if (!rootInfo) return ["yarn: root package is missing from .pnp.data.json"];
  const rootDependencies = new Map(rootInfo.packageDependencies || []);
  const failures = [];
  for (const name of dependencies) {
    const selector = rootRecord.dependencies?.[name];
    if (String(selector || "").replace(/^npm:/, "") !== specs[name]) {
      failures.push(`${name}: package.json and yarn.lock specs differ`);
      continue;
    }
    const reference = rootDependencies.get(name);
    const record = yarnSelectedRecord(lock, name, selector);
    const info = registry.get(name)?.get(reference);
    if (!record || record.resolution !== `${name}@${reference}` || !info) {
      failures.push(`${name}: PnP reference does not bind yarn.lock`);
      continue;
    }
    if (String(info.packageLocation).includes(".zip")) {
      if (
        info.linkType !== "HARD" ||
        record.linkType !== "hard" ||
        !String(reference).startsWith("npm:")
      ) {
        failures.push(
          `${name}: only registry hard-cache archives may be external`,
        );
        continue;
      }
      failures.push(
        ...validateYarnArchive(root, name, info.packageLocation, record),
      );
      continue;
    }
    failures.push(
      ...validateInstalled(
        root,
        name,
        record.version,
        path.resolve(root, info.packageLocation),
        { expectedName: name, checkCommandLinks: false },
      ),
    );
  }
  return failures;
}

function zipEntryNameSafe(name) {
  if (!name || name.startsWith("/") || name.startsWith("\\")) return false;
  if (name.length > 1 && name[1] === ":") return false;
  return !name
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function inspectRawZip(bytes, name) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  let eocd = -1;
  const lower = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lower; offset -= 1) {
    if (bytes.readUInt32LE(offset) === eocdSignature) {
      eocd = offset;
      break;
    }
  }
  if (eocd === -1)
    throw new Error(`${name}: Yarn archive has no central directory`);
  const count = bytes.readUInt16LE(eocd + 10);
  const size = bytes.readUInt32LE(eocd + 12);
  let offset = bytes.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES)
    throw new Error(`${name}: Yarn archive has too many entries`);
  if (offset + size > eocd)
    throw new Error(`${name}: Yarn archive central directory is invalid`);
  const end = offset + size;
  const names = new Set();
  let expanded = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== centralSignature) {
      throw new Error(`${name}: Yarn archive central directory is invalid`);
    }
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const entrySize = bytes.readUInt32LE(offset + 24);
    const attributes = bytes.readUInt32LE(offset + 38);
    const entryName = bytes.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    if (
      entryName.includes("\0") ||
      !zipEntryNameSafe(entryName) ||
      names.has(entryName)
    ) {
      throw new Error(`${name}: Yarn archive has a duplicate or unsafe entry`);
    }
    names.add(entryName);
    const fileType = (attributes >>> 16) & 0o170000;
    if (![0, 0o040000, 0o100000].includes(fileType)) {
      throw new Error(`${name}: Yarn archive has a non-file entry`);
    }
    if (entrySize > MAX_ZIP_ENTRY_BYTES)
      throw new Error(`${name}: Yarn archive entry is too large`);
    expanded += entrySize;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end)
    throw new Error(`${name}: Yarn archive central directory is invalid`);
  if (
    expanded > MAX_ZIP_EXPANDED_BYTES ||
    expanded > Math.max(bytes.length * 100, 1)
  ) {
    throw new Error(`${name}: Yarn archive expansion limit exceeded`);
  }
}

function validateYarnArchive(root, name, packageLocation, record) {
  let archive;
  try {
    const resolvedLocation = path.resolve(root, packageLocation);
    const marker = resolvedLocation.indexOf(".zip") + 4;
    archive = resolvedLocation.slice(0, marker);
    const inner = resolvedLocation.slice(marker).replaceAll(path.sep, "/");
    const bytes = readBuffer(archive, `${name} Yarn archive`);
    const expected = String(record.checksum || "")
      .split("/")
      .at(-1);
    const actual = crypto.createHash("sha512").update(bytes).digest("hex");
    if (!expected || expected !== actual) {
      return [`${name}: Yarn archive checksum does not match yarn.lock`];
    }
    inspectRawZip(bytes, name);
    const zip = new ZipFS(bytes, { readOnly: true });
    try {
      const files = zip.getAllFiles();
      if (files.length > MAX_ZIP_ENTRIES) {
        return [`${name}: Yarn archive has too many entries`];
      }
      let expanded = 0;
      for (const file of files) {
        const stat = zip.lstatSync(file);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
          return [`${name}: Yarn archive has an unsafe entry`];
        }
        if (stat.isFile()) {
          if (stat.size > MAX_ZIP_ENTRY_BYTES) {
            return [`${name}: Yarn archive entry is too large`];
          }
          expanded += stat.size;
        }
      }
      if (
        expanded > MAX_ZIP_EXPANDED_BYTES ||
        expanded > Math.max(bytes.length * 100, 1)
      ) {
        return [`${name}: Yarn archive expansion limit exceeded`];
      }
      const installed = JSON.parse(
        zip.readFileSync(`${inner}/package.json`, "utf8"),
      );
      if (installed.name !== name || installed.version !== record.version) {
        return [`${name}: Yarn archive identity does not match yarn.lock`];
      }
      for (const [, target] of packageBinEntries(name, installed)) {
        if (!zip.existsSync(`${inner}/${target}`)) {
          return [`${name}: Yarn archive declared bin is missing`];
        }
      }
      return [];
    } finally {
      zip.discardAndClose();
    }
  } catch (error) {
    return [
      `${name}: Yarn archive ${archive || "state"} is invalid (${error.message})`,
    ];
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function bunLocalPath(root, locator) {
  const separator = locator.indexOf(":");
  return path.resolve(root, locator.slice(separator + 1));
}

function bunOverrideVersion(pkg, name) {
  const override = pkg.overrides?.[name];
  if (override === undefined) return { present: false, version: null };
  const value = String(override);
  if (exactVersion(value)) return { present: true, version: value };
  const prefix = `npm:${name}@`;
  if (value.startsWith(prefix) && exactVersion(value.slice(prefix.length))) {
    return { present: true, version: value.slice(prefix.length) };
  }
  return { present: true, version: null };
}

function inspectBun(root, pkg, dependencies, specs) {
  if (
    fs.existsSync(path.join(root, "bun.lockb")) &&
    !fs.existsSync(path.join(root, "bun.lock"))
  ) {
    return [
      "bun: bun.lockb is unsupported; run bun install --save-text-lockfile --frozen-lockfile --lockfile-only",
    ];
  }
  const errors = [];
  const lock = parseJsonc(
    readText(path.join(root, "bun.lock"), "bun.lock"),
    errors,
    { allowTrailingComma: true },
  );
  if (errors.length > 0) {
    return [`bun.lock is malformed: ${printParseErrorCode(errors[0].error)}`];
  }
  validateObjectLimits(lock, "bun.lock");
  if (![1, 2, 3].includes(lock.lockfileVersion)) {
    return [
      `bun: unsupported lock schema ${lock.lockfileVersion || "missing"}`,
    ];
  }
  const bunfigFile = path.join(root, "bunfig.toml");
  if (fs.existsSync(bunfigFile)) {
    const bunfig = parseToml(readText(bunfigFile, "bunfig.toml"));
    validateObjectLimits(bunfig, "bunfig.toml");
    if (bunfig.install?.globalStore === true) {
      return [
        "bun: install.globalStore is unsupported; disable it and run bun install --frozen-lockfile",
      ];
    }
  }
  if (
    lock.lockfileVersion === 3 &&
    JSON.stringify(canonicalJson(lock.overrides || {})) !==
      JSON.stringify(canonicalJson(pkg.overrides || {}))
  ) {
    return ["bun: schema 3 overrides do not match package.json"];
  }
  const rootSpecs = {
    ...(lock.workspaces?.[""]?.dependencies || {}),
    ...(lock.workspaces?.[""]?.devDependencies || {}),
  };
  const failures = [];
  for (const name of dependencies) {
    if (rootSpecs[name] !== specs[name]) {
      failures.push(
        `${name}: package.json requires ${specs[name]}, bun.lock records ${rootSpecs[name] || "missing"}`,
      );
      continue;
    }
    const record = lock.packages?.[name];
    const locator = String(record?.[0] || "");
    const override = bunOverrideVersion(pkg, name);
    if (override.present && override.version === null) {
      failures.push(`${name}: unsupported Bun override ${pkg.overrides[name]}`);
      continue;
    }
    if (
      /^(?:file|workspace|link):/.test(locator.slice(locator.indexOf("@") + 1))
    ) {
      if (override.present) {
        failures.push(`${name}: Bun override does not select the local record`);
        continue;
      }
      const localLocator = locator.slice(locator.indexOf("@") + 1);
      const localRoot = bunLocalPath(root, localLocator);
      try {
        const contained = containedRealpath(
          root,
          localRoot,
          `${name} local package`,
        );
        const local = readJson(
          path.join(contained, "package.json"),
          `${name} package.json`,
        );
        failures.push(
          ...validateLocalInstall(root, name, localRoot, local.version),
        );
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
      }
      continue;
    }
    if (locator.includes("git+") || locator.includes("github:")) {
      failures.push(`${name}: unsupported Bun remote locator ${locator}`);
      continue;
    }
    if (
      lock.lockfileVersion >= 2 &&
      typeof record?.[1] === "string" &&
      record[1].startsWith("http") &&
      !record?.[3]
    ) {
      failures.push(
        `${name}: Bun schema ${lock.lockfileVersion} remote package has no integrity`,
      );
      continue;
    }
    const version = locator.slice(locator.lastIndexOf("@") + 1).split("/")[0];
    if (!exactVersion(version)) {
      failures.push(`${name}: missing or unsupported Bun package record`);
      continue;
    }
    if (override.present && override.version !== version) {
      failures.push(
        `${name}: Bun override requires ${override.version}, lock selects ${version}`,
      );
      continue;
    }
    failures.push(
      ...validateInstalled(
        root,
        name,
        version,
        path.join(root, "node_modules", name),
      ),
    );
  }
  return failures;
}

async function inspectDependencies(root) {
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(packageFile)) return { manager: null, failures: [] };
  const pkg = readJson(packageFile, "package.json");
  const dependencies = directDependencies(pkg);
  const specs = dependencySpecs(pkg);
  if (dependencies.length === 0) return { manager: null, failures: [] };
  let manager;
  try {
    manager = packageManager(root, pkg);
  } catch (error) {
    const declared = String(pkg.packageManager || "").split("@")[0];
    return {
      manager: SUPPORTED_MANAGERS.includes(declared) ? declared : null,
      failures: [error.message],
    };
  }
  if (manager === "pnpm") {
    return {
      manager,
      failures: [
        ...inspectPnpm(root, dependencies, specs),
        ...(await validateBinDirectory(root)),
      ],
    };
  }
  if (manager === "yarn") {
    return {
      manager,
      failures: [
        ...inspectYarn(root, pkg, dependencies, specs),
        ...(await validateBinDirectory(root)),
      ],
    };
  }
  if (manager === "bun") {
    return {
      manager,
      failures: [
        ...inspectBun(root, pkg, dependencies, specs),
        ...(await validateBinDirectory(root)),
      ],
    };
  }
  const lockFile = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockFile)) {
    return { manager: "npm", failures: ["package-lock.json is missing"] };
  }
  const lock = readJson(lockFile, "package-lock.json");
  const failures = [];
  if (![2, 3, 4].includes(lock.lockfileVersion)) {
    return {
      manager: "npm",
      failures: [
        `npm: unsupported package-lock schema ${lock.lockfileVersion || "missing"}`,
      ],
    };
  }
  const lockedRootSpecs = {
    ...(lock.packages?.[""]?.dependencies || {}),
    ...(lock.packages?.[""]?.devDependencies || {}),
  };
  for (const name of dependencies) {
    const relative = `node_modules/${name}`;
    const installedFile = path.join(root, relative, "package.json");
    const lockedIdentity = npmLockedIdentity(lock, name);
    if (lockedRootSpecs[name] !== specs[name]) {
      failures.push(
        `${name}: package.json requires ${specs[name]}, package-lock records ${lockedRootSpecs[name] || "missing"}`,
      );
      continue;
    }
    if (!lockedIdentity) {
      failures.push(`${name}: missing lockfile package record`);
      continue;
    }
    const installedRoot = path.dirname(installedFile);
    if (lockedIdentity.target) {
      try {
        const lockedTarget = containedRealpath(
          root,
          path.resolve(root, lockedIdentity.target),
          `${name} locked workspace`,
        );
        const installedTarget = containedRealpath(
          root,
          installedRoot,
          `${name} installed workspace`,
        );
        if (installedTarget !== lockedTarget) {
          failures.push(
            `${name}: installed workspace does not match package-lock target`,
          );
          continue;
        }
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
        continue;
      }
    }
    failures.push(
      ...validateInstalled(root, name, lockedIdentity.version, installedRoot),
    );
  }
  failures.push(...(await validateBinDirectory(root)));
  return { manager: "npm", failures };
}

function telemetryFile(env = process.env) {
  return (
    env.BS_QUALITY_PREFLIGHT_TELEMETRY_FILE ||
    path.join(
      env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
      "claude-kit",
      "quality-preflight.jsonl",
    )
  );
}

function recordFailure(root, result, env = process.env) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const record = {
    schemaVersion: 1,
    recordClass: "preflight",
    recordedAt: new Date().toISOString(),
    repositoryKey: crypto
      .createHash("sha256")
      .update(root)
      .digest("hex")
      .slice(0, 16),
    head,
    manager: result.manager,
    failureCount: result.failures.length,
    failures: result.failures,
  };
  const file = telemetryFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

async function check(root, env = process.env) {
  const result = await inspectDependencies(root);
  if (result.failures.length === 0) return result;
  try {
    recordFailure(root, result, env);
  } catch (error) {
    process.stderr.write(
      `quality dependency preflight: telemetry write failed (${error.message}); dependency failure remains authoritative\n`,
    );
  }
  const detail = result.failures.map((failure) => `  - ${failure}`).join("\n");
  const installCommand = {
    npm: "npm ci",
    pnpm: "pnpm install --frozen-lockfile",
    yarn: "yarn install --immutable",
    bun: "bun install --frozen-lockfile",
  }[result.manager];
  const remediation = installCommand
    ? `Run ${installCommand} in this exact worktree before starting quality.`
    : "Declare one exact supported packageManager and its matching lockfile, then install dependencies in this exact worktree.";
  throw new Error(
    `package dependencies are not ready:\n${detail}\n${remediation}`,
  );
}

async function main(argv = process.argv.slice(2)) {
  const repoIndex = argv.indexOf("--repo");
  const root = repoIndex === -1 ? "" : path.resolve(argv[repoIndex + 1] || "");
  if (!root || argv.length !== 2) {
    process.stderr.write(
      "usage: quality-dependency-preflight.js --repo <path>\n",
    );
    return 64;
  }
  try {
    await check(root);
    process.stdout.write("[quality] package dependency preflight passed\n");
    return 0;
  } catch (error) {
    process.stderr.write(`quality dependency preflight: ${error.message}\n`);
    return 78;
  }
}

module.exports = { check, inspectDependencies, isSubpath, telemetryFile };

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}
