#!/usr/bin/env node
"use strict";

// Product delivery evidence is deliberately separate from quality correctness.
// It classifies what a PRD/task set proves; it does not alter gate or merge policy.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PHASES = new Set(["contract", "implementation", "hosted", "validation"]);
const CLAIMS = new Set(["contract", "local-product", "hosted", "validated"]);
const SOURCE_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|php|cs|swift|sh)$/i;

function fail(message) {
  throw new Error(message);
}

function read(file, label) {
  if (!file) fail(`${label} is required`);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(`${label} cannot be read: ${error.message}`);
  }
}

function parseTasks(source) {
  const tasks = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*- \[[ xX]\] (\d+\.0) (.+)$/);
    if (!match) continue;
    const task = {
      id: match[1],
      title: match[2].trim(),
      line: index + 1,
      completed: /\[x\]/i.test(lines[index]),
    };
    let cursor = index + 1;
    while (
      cursor < lines.length &&
      !/^\s*- \[[ xX]\] \d+\.0 /.test(lines[cursor])
    ) {
      const field = lines[cursor].match(
        /^\s+- (Phase|Delivers|Evidence|Verification):\s*(.+)$/i,
      );
      if (field) task[field[1].toLowerCase()] = field[2].trim();
      cursor += 1;
    }
    tasks.push(task);
  }
  return tasks;
}

function userFacing(prd) {
  return /^## User stories\s*$/im.test(prd) && /(?:^|\n)\s*- As\s+/i.test(prd);
}

function validate(prdPath, tasksPath) {
  const prd = read(prdPath, "PRD");
  const taskSource = read(tasksPath, "task list");
  const tasks = parseTasks(taskSource);
  const errors = [];
  if (tasks.length === 0) errors.push("task list has no parent tasks");
  for (const task of tasks) {
    if (!task.phase) errors.push(`${task.id} is missing Phase`);
    else if (!PHASES.has(task.phase))
      errors.push(`${task.id} has invalid Phase '${task.phase}'`);
    if (!task.delivers) errors.push(`${task.id} is missing Delivers`);
    if (!(task.evidence || task.verification))
      errors.push(`${task.id} is missing Evidence`);
  }
  const implementation = tasks.filter(
    (task) => task.phase === "implementation",
  );
  if (userFacing(prd) && implementation.length === 0) {
    errors.push("user-facing PRD has no implementation task");
  }
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    userFacing: userFacing(prd),
    tasks,
    errors,
  };
}

function readJson(file, label) {
  if (!file) return {};
  try {
    return JSON.parse(read(file, label));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function sha256File(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function receiptRecord(value, label, fields, head, evidencePath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return `${label} must name an immutable receipt`;
  }
  if (
    !nonEmptyString(value.receipt) ||
    !/^[a-f0-9]{64}$/i.test(value.sha256 || "")
  ) {
    return `${label} needs receipt and sha256`;
  }
  const receipt = path.resolve(path.dirname(evidencePath || ""), value.receipt);
  const evidenceRoot = path.dirname(path.resolve(evidencePath || ""));
  if (!receipt.startsWith(`${evidenceRoot}${path.sep}`)) {
    return `${label} receipt must stay inside the evidence directory`;
  }
  let record;
  try {
    if (!fs.statSync(receipt).isFile()) return `${label} receipt is not a file`;
    if (sha256File(receipt) !== value.sha256.toLowerCase())
      return `${label} receipt digest does not match`;
    record = JSON.parse(fs.readFileSync(receipt, "utf8"));
  } catch (error) {
    return `${label} receipt cannot be verified: ${error.message}`;
  }
  for (const field of fields) {
    if (!nonEmptyString(record[field]))
      return `${label} receipt is missing ${field}`;
  }
  if (
    record.schemaVersion !== 1 ||
    record.kind !== label ||
    record.head !== head ||
    !nonEmptyString(record.observedAt) ||
    Number.isNaN(Date.parse(record.observedAt))
  ) {
    return `${label} receipt has invalid schema, kind, head, or observedAt`;
  }
  return null;
}

function productionCodeChange(file) {
  return (
    typeof file === "string" &&
    !/(?:^|\/)__(?:tests|fixtures)__\//.test(file) &&
    !/(?:^|\/)(?:test|tests|docs|config|fixtures)\//.test(file) &&
    !/^\.github\//.test(file) &&
    !/(?:\.test|\.spec)\.[cm]?[jt]sx?$/i.test(file) &&
    SOURCE_EXTENSIONS.test(file)
  );
}

function verifyClaim(
  result,
  claim,
  changedFiles,
  evidence,
  { head, evidencePath } = {},
) {
  if (!CLAIMS.has(claim)) fail(`invalid delivery claim '${claim}'`);
  const errors = [...result.errors];
  const phases = new Set(result.tasks.map((task) => task.phase));
  const sourceChange = changedFiles.some(productionCodeChange);
  const localEvidence = [
    receiptRecord(
      evidence.behavioralTests,
      "behavioralTests",
      ["command", "artifact"],
      head,
      evidencePath,
    ),
    receiptRecord(
      evidence.acceptanceEvidence,
      "acceptanceEvidence",
      ["artifact"],
      head,
      evidencePath,
    ),
  ].filter(Boolean);
  if (claim === "contract") {
    if (
      !changedFiles.some((file) =>
        /(?:prd|decision|adr|architecture)/i.test(file),
      )
    ) {
      errors.push(
        "contract claim needs an approved PRD, task, or architecture change",
      );
    }
  }
  if (["local-product", "hosted", "validated"].includes(claim)) {
    if (!phases.has("implementation"))
      errors.push(`${claim} claim needs an implementation task`);
    if (!sourceChange)
      errors.push(`${claim} claim needs a production-code change`);
    errors.push(...localEvidence.map((error) => `${claim} claim ${error}`));
  }
  if (["hosted", "validated"].includes(claim)) {
    for (const error of [
      receiptRecord(
        evidence.deploymentReceipt,
        "deploymentReceipt",
        ["receipt", "environment"],
        head,
        evidencePath,
      ),
      receiptRecord(
        evidence.hostedJourney,
        "hostedJourney",
        ["url", "artifact"],
        head,
        evidencePath,
      ),
    ].filter(Boolean))
      errors.push(`${claim} claim ${error}`);
  }
  if (claim === "validated") {
    const error = receiptRecord(
      evidence.realUserEvidence,
      "realUserEvidence",
      ["record"],
      head,
      evidencePath,
    );
    if (error) errors.push(`validated claim ${error}`);
  }
  return { schemaVersion: 1, claim, valid: errors.length === 0, errors };
}

function next(result) {
  if (!result.valid)
    return { schemaVersion: 1, status: "UNVERIFIED", errors: result.errors };
  const open = result.tasks.filter((task) => !task.completed);
  const contract = open.filter((task) => task.phase === "contract");
  if (contract.length)
    return { schemaVersion: 1, status: "next-contract", task: contract[0] };
  const implementation = open.filter((task) => task.phase === "implementation");
  if (implementation.length)
    return {
      schemaVersion: 1,
      status: "next-implementation",
      task: implementation[0],
    };
  const external = open.filter((task) =>
    ["hosted", "validation"].includes(task.phase),
  );
  if (external.length)
    return { schemaVersion: 1, status: "external-gate", task: external[0] };
  return { schemaVersion: 1, status: "product-done" };
}

function options(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`unexpected argument '${token}'`);
    out[token.slice(2)] = argv[++index];
    if (!out[token.slice(2)]) fail(`${token} requires a value`);
  }
  return out;
}

function main(argv) {
  const [command, ...raw] = argv;
  const args = options(raw);
  const result = validate(args.prd, args.tasks);
  let output = result;
  if (command === "verify-claim") {
    output = verifyClaim(
      result,
      args.claim,
      readJson(args["changed-files"], "changed files"),
      readJson(args.evidence, "evidence"),
      { head: args.head, evidencePath: args.evidence },
    );
  } else if (command === "next") output = next(result);
  else if (command !== "validate")
    fail(
      "usage: product-completion.js validate|verify-claim|next --prd <file> --tasks <file>",
    );
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (output.valid === false || output.status === "UNVERIFIED")
    process.exitCode = 1;
}

module.exports = { parseTasks, validate, verifyClaim, next };
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`product-completion: ${error.message}\n`);
    process.exitCode = 1;
  }
}
