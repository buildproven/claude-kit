#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const impact = require("./test-impact");

function readJson(source, label) {
  try {
    return JSON.parse(fs.readFileSync(source, "utf8"));
  } catch (error) {
    throw new Error(`cannot read valid ${label} JSON`, { cause: error });
  }
}

function repositoryRoot(cwd) {
  if (typeof cwd !== "string" || !cwd || !fs.statSync(cwd).isDirectory()) {
    throw new Error("hook requires an existing cwd directory");
  }
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (/not a git repository|must be run in a work tree/.test(result.stderr))
      return null;
    throw new Error("cannot resolve task repository");
  }
  return result.stdout.trim();
}

function legacyPlan(root, files) {
  const packageFile = path.join(root, "package.json");
  if (!fs.existsSync(packageFile)) {
    throw new Error(
      `configure ${impact.POLICY_FILE} for this repository's affected tests`,
    );
  }
  const pkg = readJson(packageFile, "package");
  if (typeof pkg.scripts?.test !== "string" || !pkg.scripts.test.trim()) {
    throw new Error(
      `configure ${impact.POLICY_FILE}; no repository test command exists`,
    );
  }
  const manager =
    [
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
    ].find(([file]) => fs.existsSync(path.join(root, file)))?.[1] || "npm";
  return {
    mode: "audit",
    reason: "legacy-repository-test-command",
    files,
    commands: [{ executable: manager, args: ["test"] }],
  };
}

function main() {
  const payload = readJson(0, "hook input");
  const root = repositoryRoot(payload?.cwd);
  if (!root) return 0;
  const files = impact.workingTreePaths(root);
  if (files.length === 0) return 0;
  const configured = fs.existsSync(path.join(root, impact.POLICY_FILE));
  const selected = configured
    ? impact.plan(files, impact.loadPolicy(root))
    : files.every((file) => /\.(md|txt)$/.test(file))
      ? { mode: "none", reason: "documentation-only", files, commands: [] }
      : legacyPlan(root, files);
  return impact.execute(selected, root);
}

try {
  process.exitCode = main() === 0 ? 0 : 2;
} catch (error) {
  process.stderr.write(`task-completed-check: ${error.message}\n`);
  process.exitCode = 2;
}
