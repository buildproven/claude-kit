#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

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
  if (manager !== "npm") {
    return {
      manager,
      failures: [
        `${manager}: source-owned exact dependency-state verification is not available; quality refuses to execute repository-controlled package-manager state`,
      ],
    };
  }
  const lockFile = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockFile)) {
    return { manager: "npm", failures: ["package-lock.json is missing"] };
  }
  const lock = readJson(lockFile, "package-lock.json");
  const failures = [];
  const lockedRootSpecs = {
    ...(lock.packages?.[""]?.dependencies || {}),
    ...(lock.packages?.[""]?.devDependencies || {}),
  };
  for (const name of dependencies) {
    const relative = `node_modules/${name}`;
    const installedFile = path.join(root, relative, "package.json");
    const lockedVersion = npmLockedVersion(lock, name);
    if (lockedRootSpecs[name] !== specs[name]) {
      failures.push(
        `${name}: package.json requires ${specs[name]}, package-lock records ${lockedRootSpecs[name] || "missing"}`,
      );
      continue;
    }
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
