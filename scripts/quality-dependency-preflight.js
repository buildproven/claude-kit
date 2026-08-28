#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error.message}`, {
      cause: error,
    });
  }
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

function packageBinNames(name, pkg) {
  if (typeof pkg.bin === "string") return [name.split("/").at(-1)];
  if (!pkg.bin || typeof pkg.bin !== "object") return [];
  return Object.keys(pkg.bin);
}

function packageManager(root, pkg) {
  const declared = String(pkg.packageManager || "").split("@")[0];
  if (["npm", "pnpm", "yarn", "bun"].includes(declared)) return declared;
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (
    fs.existsSync(path.join(root, "bun.lock")) ||
    fs.existsSync(path.join(root, "bun.lockb"))
  ) {
    return "bun";
  }
  return "npm";
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function yarnLockedReference(lockText, name, requested) {
  const descriptor = new RegExp(
    `${regexEscape(name)}@(?:npm:)?${regexEscape(requested)}(?:\\"|,|:)`,
  );
  const resolution = new RegExp(
    `^\\s+resolution: ["']?${regexEscape(name)}@([^"'\\s]+)`,
    "m",
  );
  for (const block of lockText.split(/\n(?=\S)/)) {
    if (!descriptor.test(block)) continue;
    const match = block.match(resolution);
    if (match) return match[1];
  }
  return null;
}

function yarnWorkspaceReference(lockText, name, installedReference) {
  if (!installedReference?.startsWith("workspace:")) return null;
  const resolution = new RegExp(
    `^\\s+resolution: ["']?${regexEscape(name)}@${regexEscape(installedReference)}["']?\\s*$`,
    "m",
  );
  return resolution.test(lockText) ? installedReference : null;
}

function inspectPnpDependencies(root, dependencies, specs) {
  const failures = [];
  const pnpFile = path.join(root, ".pnp.cjs");
  const lockFile = path.join(root, "yarn.lock");
  if (!fs.existsSync(lockFile)) return ["yarn.lock is missing"];
  const lockText = fs.readFileSync(lockFile, "utf8");
  let api;
  try {
    api = createRequire(pnpFile)(pnpFile);
  } catch (error) {
    return [`yarn: .pnp.cjs is unreadable (${error.message})`];
  }
  if (
    typeof api.findPackageLocator !== "function" ||
    typeof api.getPackageInformation !== "function" ||
    typeof api.resolveToUnqualified !== "function"
  ) {
    return ["yarn: .pnp.cjs does not expose the required resolution API"];
  }
  const rootLocator = api.findPackageLocator(`${root}${path.sep}`);
  const rootInfo = rootLocator ? api.getPackageInformation(rootLocator) : null;
  if (!(rootInfo?.packageDependencies instanceof Map)) {
    return ["yarn: root package is missing from PnP state"];
  }
  for (const name of dependencies) {
    try {
      const resolved = api.resolveToUnqualified(name, `${root}${path.sep}`);
      if (!resolved) {
        failures.push(`${name}: package is not resolvable from Yarn PnP state`);
      }
    } catch {
      failures.push(`${name}: package is not resolvable from Yarn PnP state`);
      continue;
    }
    const installedReference = rootInfo.packageDependencies.get(name);
    const lockedReference =
      yarnLockedReference(lockText, name, specs[name]) ||
      (String(specs[name]).startsWith("workspace:")
        ? yarnWorkspaceReference(lockText, name, installedReference)
        : null);
    if (!lockedReference) {
      failures.push(
        `${name}: current manifest has no matching yarn.lock record`,
      );
    } else if (installedReference !== lockedReference) {
      failures.push(
        `${name}: PnP reference ${installedReference || "missing"}, yarn.lock requires ${lockedReference}`,
      );
    }
  }
  return failures;
}

function inspectLinkedManager(root, manager, dependencies, specs) {
  const failures = [];
  const lockMarkers = {
    pnpm: ["pnpm-lock.yaml"],
    yarn: ["yarn.lock"],
    bun: ["bun.lock", "bun.lockb"],
  }[manager];
  if (!lockMarkers.some((marker) => fs.existsSync(path.join(root, marker)))) {
    failures.push(`${manager}: lockfile is missing`);
    return { manager, failures };
  }
  const readinessMarkers = {
    pnpm: ["node_modules/.modules.yaml"],
    yarn: ["node_modules", ".pnp.cjs", ".yarn/install-state.gz"],
    bun: ["node_modules/.bin"],
  }[manager];
  if (
    !readinessMarkers.some((marker) => fs.existsSync(path.join(root, marker)))
  ) {
    failures.push(`${manager}: installed dependency state is missing`);
    return { manager, failures };
  }
  if (manager === "yarn" && fs.existsSync(path.join(root, ".pnp.cjs"))) {
    return {
      manager,
      failures: inspectPnpDependencies(root, dependencies, specs),
    };
  }
  for (const name of dependencies) {
    const installedFile = path.join(root, "node_modules", name, "package.json");
    if (!fs.existsSync(installedFile)) {
      failures.push(`${name}: package is not linked in this worktree`);
      continue;
    }
    const installed = readJson(installedFile, `${name} package.json`);
    for (const bin of packageBinNames(name, installed)) {
      if (!fs.existsSync(path.join(root, "node_modules", ".bin", bin))) {
        failures.push(`${name}: package-local executable ${bin} is missing`);
      }
    }
  }
  return { manager, failures };
}

function npmLockedVersion(lock, name) {
  const relative = `node_modules/${name}`;
  const record = lock.packages?.[relative];
  if (typeof record?.version === "string") return record.version;
  if (record?.link === true && typeof record.resolved === "string") {
    const target = lock.packages?.[record.resolved];
    if (typeof target?.version === "string") return target.version;
  }
  const legacy = lock.dependencies?.[name];
  return typeof legacy?.version === "string" ? legacy.version : null;
}

function inspectDependencies(root) {
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(packageFile)) return { manager: null, failures: [] };
  const pkg = readJson(packageFile, "package.json");
  const dependencies = directDependencies(pkg);
  const specs = dependencySpecs(pkg);
  const manager = packageManager(root, pkg);
  if (dependencies.length === 0) return { manager, failures: [] };
  if (manager !== "npm")
    return inspectLinkedManager(root, manager, dependencies, specs);
  const lockFile = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockFile)) {
    return { manager: "npm", failures: ["package-lock.json is missing"] };
  }
  const lock = readJson(lockFile, "package-lock.json");
  const failures = [];
  for (const name of dependencies) {
    const relative = `node_modules/${name}`;
    const installedFile = path.join(root, relative, "package.json");
    const lockedVersion = npmLockedVersion(lock, name);
    if (!lockedVersion) {
      failures.push(`${name}: missing lockfile package record`);
      continue;
    }
    if (!fs.existsSync(installedFile)) {
      failures.push(`${name}: package is not installed`);
      continue;
    }
    const installed = readJson(installedFile, `${name} package.json`);
    if (installed.version !== lockedVersion) {
      failures.push(
        `${name}: installed ${installed.version || "unknown"}, lockfile requires ${lockedVersion}`,
      );
      continue;
    }
    for (const bin of packageBinNames(name, installed)) {
      if (!fs.existsSync(path.join(root, "node_modules", ".bin", bin))) {
        failures.push(`${name}: package-local executable ${bin} is missing`);
      }
    }
  }
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

function check(root, env = process.env) {
  const result = inspectDependencies(root);
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
  throw new Error(
    `package dependencies are not ready:\n${detail}\nRun ${installCommand} in this exact worktree before starting quality.`,
  );
}

function main(argv = process.argv.slice(2)) {
  const repoIndex = argv.indexOf("--repo");
  const root = repoIndex === -1 ? "" : path.resolve(argv[repoIndex + 1] || "");
  if (!root || argv.length !== 2) {
    process.stderr.write(
      "usage: quality-dependency-preflight.js --repo <path>\n",
    );
    return 64;
  }
  try {
    check(root);
    process.stdout.write("[quality] package dependency preflight passed\n");
    return 0;
  } catch (error) {
    process.stderr.write(`quality dependency preflight: ${error.message}\n`);
    return 78;
  }
}

module.exports = { check, inspectDependencies, telemetryFile };

if (require.main === module) process.exit(main());
