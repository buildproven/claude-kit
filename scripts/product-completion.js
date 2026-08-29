#!/usr/bin/env node
"use strict";

// Product delivery evidence is deliberately separate from quality correctness.
// It classifies what a PRD/task set proves; it does not alter gate or merge policy.
const fs = require("node:fs");
const { sha256, verifyReceipt } = require("./product-evidence");

const PHASES = new Set(["contract", "implementation", "hosted", "validation"]);
const CLAIMS = new Set(["contract", "local-product", "hosted", "validated"]);
const NON_PRODUCT_PATH =
  /^(?:\.github\/|docs?\/|tests?\/|fixtures?\/)|(?:^|\/)(?:__tests__|__fixtures__)\//i;
const NON_PRODUCT_TEST_FILE = /(?:\.test|\.spec)\.[^/]+$/i;
const NON_PRODUCT_ROOT_NAMES = new Set([
  "AGENTS",
  "CHANGELOG",
  "CLAUDE",
  "CODE_OF_CONDUCT",
  "CONTRIBUTING",
  "LICENSE",
  "README",
  "SECURITY",
]);
const EVIDENCE_KEYS = new Set([
  "schemaVersion",
  "repository",
  "repositoryId",
  "expectedEnvironment",
  "deploymentIdentity",
  "behavioralTests",
  "acceptanceEvidence",
  "deploymentReceipt",
  "hostedJourney",
  "realUserEvidence",
]);

function fail(message) {
  throw new Error(message);
}

function readBytes(file, label) {
  if (!file) fail(`${label} is required`);
  try {
    return fs.readFileSync(file);
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
  const prdBytes = readBytes(prdPath, "PRD");
  const taskBytes = readBytes(tasksPath, "task list");
  const prd = prdBytes.toString("utf8");
  const taskSource = taskBytes.toString("utf8");
  const requirementsDigest = sha256(
    Buffer.from(
      JSON.stringify({
        prdSha256: sha256(prdBytes),
        tasksSha256: sha256(taskBytes),
      }),
    ),
  );
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
    requirementsDigest,
    tasks,
    errors,
  };
}

function readJson(file, label, expectedDigest = null) {
  if (!file) return {};
  try {
    const body = fs.readFileSync(file);
    if (
      expectedDigest &&
      sha256(body) !== String(expectedDigest).toLowerCase()
    ) {
      fail(`${label} changed after campaign creation`);
    }
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    if (error.message === `${label} changed after campaign creation`) {
      throw error;
    }
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function receiptRecord(value, label, expected, options) {
  try {
    return {
      payload: verifyReceipt(value, { ...expected, kind: label }, options),
    };
  } catch (error) {
    return { error: error.message };
  }
}

function productionCodeChange(file) {
  if (typeof file !== "string" || file.length === 0) return false;
  const rootName = file.includes("/")
    ? null
    : file.split(".", 1)[0].toUpperCase();
  return (
    !NON_PRODUCT_PATH.test(file) &&
    !NON_PRODUCT_TEST_FILE.test(file) &&
    !NON_PRODUCT_ROOT_NAMES.has(rootName)
  );
}

function evidenceIndexError(evidence, repository, repositoryId) {
  if (
    evidence.schemaVersion === 2 &&
    evidence.repository === repository &&
    evidence.repositoryId === repositoryId &&
    /^[^/]+\/[^/]+$/.test(repository || "") &&
    /^[1-9][0-9]*$/.test(repositoryId || "") &&
    !Object.keys(evidence).some((key) => !EVIDENCE_KEYS.has(key))
  ) {
    return null;
  }
  return "delivery evidence has invalid schema, repository identity, or fields";
}

function receiptErrors(records, prefix) {
  return records
    .filter(({ error }) => error)
    .map(({ error }) => `${prefix} ${error}`);
}

function localReceipts(evidence, expected, verification) {
  return [
    receiptRecord(
      evidence.behavioralTests,
      "behavioralTests",
      expected,
      verification,
    ),
    receiptRecord(
      evidence.acceptanceEvidence,
      "acceptanceEvidence",
      expected,
      verification,
    ),
  ];
}

function hostedReceipts(evidence, expected, verification) {
  return [
    receiptRecord(
      evidence.deploymentReceipt,
      "deploymentReceipt",
      expected,
      verification,
    ),
    receiptRecord(
      evidence.hostedJourney,
      "hostedJourney",
      expected,
      verification,
    ),
  ];
}

function verifyClaim(
  result,
  claim,
  changedFiles,
  evidence,
  { head, evidencePath, repository, repositoryId, trustedPublicKey } = {},
) {
  if (!CLAIMS.has(claim)) fail(`invalid delivery claim '${claim}'`);
  const errors = [...result.errors];
  const phases = new Set(result.tasks.map((task) => task.phase));
  const sourceChange = changedFiles.some(productionCodeChange);
  const verification = { evidencePath, trustedPublicKey };
  const indexError = evidenceIndexError(evidence, repository, repositoryId);
  if (indexError) errors.push(indexError);
  if (claim === "contract") {
    for (const file of changedFiles.filter(productionCodeChange)) {
      errors.push(
        `contract claim cannot cover product-affecting file '${file}'`,
      );
    }
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
    errors.push(
      ...receiptErrors(
        localReceipts(
          evidence,
          {
            head,
            repository,
            repositoryId,
            requirementsDigest: result.requirementsDigest,
          },
          verification,
        ),
        `${claim} claim`,
      ),
    );
  }
  if (["hosted", "validated"].includes(claim)) {
    if (
      !nonEmptyString(evidence.expectedEnvironment) ||
      !nonEmptyString(evidence.deploymentIdentity)
    ) {
      errors.push(
        `${claim} claim needs expectedEnvironment and deploymentIdentity`,
      );
    }
    errors.push(
      ...receiptErrors(
        hostedReceipts(
          evidence,
          {
            head,
            repository,
            repositoryId,
            requirementsDigest: result.requirementsDigest,
            environment: evidence.expectedEnvironment,
            deploymentIdentity: evidence.deploymentIdentity,
          },
          verification,
        ),
        `${claim} claim`,
      ),
    );
  }
  if (claim === "validated") {
    const { error } = receiptRecord(
      evidence.realUserEvidence,
      "realUserEvidence",
      {
        head,
        repository,
        repositoryId,
        requirementsDigest: result.requirementsDigest,
        environment: evidence.expectedEnvironment,
        deploymentIdentity: evidence.deploymentIdentity,
      },
      verification,
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
      readJson(args.evidence, "evidence", args["evidence-sha256"]),
      {
        head: args.head,
        evidencePath: args.evidence,
        repository: args.repository,
        repositoryId: args["repository-id"],
      },
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

module.exports = {
  next,
  parseTasks,
  productionCodeChange,
  validate,
  verifyClaim,
};
if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`product-completion: ${error.message}\n`);
    process.exitCode = 1;
  }
}
