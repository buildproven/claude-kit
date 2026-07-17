#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadManifest, validateIdentity } = require("./quality-invocation");

function packageManager(root, pkg = {}) {
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

function configuredExtensions(pkg) {
  const extensions = new Set();
  for (const [pattern, commands] of Object.entries(pkg["lint-staged"] || {})) {
    const commandList = Array.isArray(commands) ? commands : [commands];
    if (
      !commandList.some(
        (command) =>
          typeof command === "string" &&
          /(^|[ /])prettier([ /]|$)/.test(command),
      )
    ) {
      continue;
    }
    const brace = pattern.match(/\{([^}]+)\}/);
    if (brace) {
      for (const extension of brace[1].split(",")) extensions.add(extension);
    } else {
      const simple = pattern.match(/\.([a-z0-9]+)$/i);
      if (simple) extensions.add(simple[1]);
    }
  }
  return extensions;
}

function resolveFormatPlan(root, files) {
  const packageFile = path.join(root, "package.json");
  let pkg = {};
  if (fs.existsSync(packageFile)) {
    try {
      pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    } catch (error) {
      throw new Error(`package.json is not valid JSON: ${error.message}`, {
        cause: error,
      });
    }
  }
  const manager = packageManager(root, pkg);
  const extensions = configuredExtensions(pkg);
  const selected =
    extensions.size === 0
      ? files
      : files.filter((file) =>
          extensions.has(path.extname(file).slice(1).toLowerCase()),
        );
  const args =
    manager === "npm"
      ? [
          "exec",
          "--",
          "prettier",
          "--write",
          "--ignore-unknown",
          "--",
          ...selected,
        ]
      : manager === "bun"
        ? ["x", "prettier", "--write", "--ignore-unknown", "--", ...selected]
        : [
            "exec",
            "prettier",
            "--write",
            "--ignore-unknown",
            "--",
            ...selected,
          ];
  return { manager, args, files: selected };
}

function main() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--manifest");
  if (manifestIndex === -1 || !args[manifestIndex + 1]) {
    throw new Error("--manifest is required");
  }
  const manifestPath = args[manifestIndex + 1];
  const dryRun = args.includes("--dry-run");
  const separator = args.indexOf("--");
  const files = separator === -1 ? [] : args.slice(separator + 1);
  const { manifest } = loadManifest(manifestPath);
  validateIdentity(manifest, process.cwd());
  const plan = resolveFormatPlan(manifest.repo.realpath, files);
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  if (plan.files.length === 0) return;
  const result = spawnSync(plan.manager, plan.args, {
    cwd: manifest.repo.realpath,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

module.exports = { configuredExtensions, packageManager, resolveFormatPlan };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality-format: ${error.message}\n`);
    process.exit(1);
  }
}
