#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const POLICY_FILE = ".buildproven/test-impact.json";
const JS_SOURCE = /\.(?:[cm]?js|jsx|ts|tsx)$/;
const PYTHON = /\.py$/;
const PYTHON_TEST = /(^|\/)(?:tests?|test)\/.*\.py$|(^|\/)test_[^/]+\.py$/;
const DOC_ONLY = /\.(?:md|txt)$/;

function command(value, label) {
  const invalid =
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    typeof value.executable !== "string" ||
    value.executable.trim() === "" ||
    value.executable.includes("\0") ||
    !Array.isArray(value.args) ||
    value.args.some((part) => typeof part !== "string" || part.includes("\0"));
  if (invalid)
    throw new Error(`${label} requires a non-empty executable and string args`);
  return { executable: value.executable, args: [...value.args] };
}

function validatePolicy(value) {
  if (!value || Array.isArray(value) || value.version !== 1)
    throw new Error(`${POLICY_FILE} must declare version 1`);
  const unsupported = Object.keys(value).filter(
    (key) => !["version", "jsRunner", "mappings", "audits"].includes(key),
  );
  if (unsupported.length > 0)
    throw new Error(
      `${POLICY_FILE} has unsupported fields: ${unsupported.join(", ")}`,
    );
  const allowedRunners = new Set(["vitest", "jest", "none"]);
  const jsRunner = value.jsRunner || "vitest";
  if (!allowedRunners.has(jsRunner))
    throw new Error(`${POLICY_FILE} jsRunner must be vitest, jest, or none`);
  const normalizeRules = (rules, kind) => {
    if (rules !== undefined && !Array.isArray(rules))
      throw new Error(`${POLICY_FILE} ${kind} must be an array`);
    return (rules || []).map((rule, index) => {
      if (
        !rule ||
        Array.isArray(rule) ||
        !Array.isArray(rule.paths) ||
        rule.paths.length === 0 ||
        rule.paths.some((glob) => typeof glob !== "string" || glob === "") ||
        !Array.isArray(rule.commands) ||
        rule.commands.length === 0
      )
        throw new Error(`${POLICY_FILE} ${kind}[${index}] is invalid`);
      if (
        kind === "audits" &&
        (!rule.reason || typeof rule.reason !== "string")
      )
        throw new Error(`${POLICY_FILE} audits[${index}] requires a reason`);
      return {
        paths: [...rule.paths],
        commands: rule.commands.map((item, commandIndex) =>
          command(
            item,
            `${POLICY_FILE} ${kind}[${index}].commands[${commandIndex}]`,
          ),
        ),
        ...(kind === "audits" ? { reason: rule.reason } : {}),
      };
    });
  };
  return {
    version: 1,
    jsRunner,
    mappings: normalizeRules(value.mappings, "mappings"),
    audits: normalizeRules(value.audits, "audits"),
  };
}

function matches(file, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith("/")
      ? file.startsWith(pattern)
      : path.matchesGlob(file, pattern),
  );
}

function uniqueCommands(commands) {
  const seen = new Set();
  return commands.filter((item) => {
    const key = JSON.stringify([item.executable, item.args]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function relatedCommand(runner, files) {
  if (runner === "vitest")
    return {
      executable: "npx",
      args: ["vitest", "related", "--run", ...files],
    };
  if (runner === "jest")
    return {
      executable: "npx",
      args: ["jest", "--findRelatedTests", ...files],
    };
  return null;
}

function plan(changed, rawPolicy = { version: 1 }) {
  const policy = validatePolicy({ version: 1, ...rawPolicy });
  const files = [...new Set(changed.filter(Boolean))].sort();
  if (files.length === 0)
    return {
      mode: "unmapped",
      reason: "unknown-change-set",
      files: [],
      uncovered: [],
      remediation: "provide the changed paths before authorizing tests",
    };

  const auditRules = policy.audits.filter((rule) =>
    files.some((file) => matches(file, rule.paths)),
  );
  if (auditRules.length > 0)
    return {
      mode: "audit",
      reason: auditRules.map((rule) => rule.reason).join("; "),
      files,
      commands: uniqueCommands(auditRules.flatMap((rule) => rule.commands)),
    };

  const commands = [];
  const covered = new Set();
  for (const rule of policy.mappings) {
    const matched = files.filter((file) => matches(file, rule.paths));
    if (matched.length === 0) continue;
    matched.forEach((file) => covered.add(file));
    commands.push(...rule.commands);
  }

  // A mapping often names its exact behavioral test in argv. When that test
  // is changed in the same diff, it is already exercised by the mapped
  // command and must not also be fed to the dependency-aware runner. This is
  // exact argv equality only: substrings and inferred paths remain uncovered.
  for (const selected of commands) {
    for (const file of files) {
      if (selected.args.includes(file)) covered.add(file);
    }
  }

  const js = files.filter((file) => JS_SOURCE.test(file) && !covered.has(file));
  if (js.length > 0) {
    const related = relatedCommand(policy.jsRunner, js);
    if (related) {
      commands.push(related);
      js.forEach((file) => covered.add(file));
    }
  }
  const pythonTests = files.filter(
    (file) => PYTHON.test(file) && PYTHON_TEST.test(file) && !covered.has(file),
  );
  if (pythonTests.length > 0) {
    commands.push({ executable: "pytest", args: pythonTests });
    pythonTests.forEach((file) => covered.add(file));
  }
  files
    .filter((file) => DOC_ONLY.test(file) && !covered.has(file))
    .forEach((file) => covered.add(file));

  const uncovered = files.filter((file) => !covered.has(file));
  if (uncovered.length > 0)
    return {
      mode: "unmapped",
      reason: "unproven-test-impact",
      files,
      commands: uniqueCommands(commands),
      uncovered,
      remediation: `map ${uncovered.join(", ")} in ${POLICY_FILE}`,
    };

  return commands.length > 0
    ? {
        mode: "focused",
        reason: "evidence-backed-selector",
        files,
        commands: uniqueCommands(commands),
      }
    : { mode: "none", reason: "documentation-only", files, commands: [] };
}

function loadPolicy(root = process.cwd()) {
  const policyPath = path.join(root, POLICY_FILE);
  if (!fs.existsSync(policyPath)) return validatePolicy({ version: 1 });
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch (error) {
    throw new Error(`${POLICY_FILE} is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  return validatePolicy(parsed);
}

function policyDigest(root = process.cwd()) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(root, POLICY_FILE)))
    .digest("hex");
}

function execute(result, root = process.cwd()) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.mode === "unmapped") {
    process.stderr.write(`test-impact: ${result.remediation}\n`);
    return 2;
  }
  for (const item of result.commands || []) {
    const child = spawnSync(item.executable, item.args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    if (child.error) {
      process.stderr.write(`test-impact: ${child.error.message}\n`);
      return 1;
    }
    if (child.status !== 0) return child.status ?? 1;
  }
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? [] : argv.slice(0, separator);
  const shouldExecute = options.includes("--execute");
  const digestIndex = options.indexOf("--policy-sha256");
  const expectedDigest = digestIndex === -1 ? "" : options[digestIndex + 1];
  const files = separator === -1 ? argv : argv.slice(separator + 1);
  if (digestIndex !== -1 && !/^[0-9a-f]{64}$/.test(expectedDigest || "")) {
    process.stderr.write(
      "test-impact: --policy-sha256 requires a SHA-256 hex digest\n",
    );
    return 2;
  }
  if (expectedDigest && policyDigest() !== expectedDigest) {
    process.stderr.write(
      `test-impact: ${POLICY_FILE} does not match the persisted exact-head policy\n`,
    );
    return 2;
  }
  const result = plan(
    files.map((file) => path.normalize(file)),
    loadPolicy(),
  );
  if (shouldExecute) return execute(result);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  POLICY_FILE,
  execute,
  loadPolicy,
  main,
  plan,
  policyDigest,
  validatePolicy,
};
