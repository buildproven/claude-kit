#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const TOP_LEVEL_FIELDS = new Set([
  "url",
  "required_status_checks",
  "required_pull_request_reviews",
  "restrictions",
  "required_signatures",
  "enforce_admins",
  "required_linear_history",
  "allow_force_pushes",
  "allow_deletions",
  "block_creations",
  "required_conversation_resolution",
  "lock_branch",
  "allow_fork_syncing",
]);
const GITHUB_ACTIONS_APP_ID = 15368;

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value;
}

function assertClosedObject(value, allowed, label) {
  const object = assertObject(value, label);
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unsupported field(s): ${unknown.join(", ")}`);
  }
  return object;
}

function assertBooleanRule(protection, field, expected) {
  const rule = assertClosedObject(
    protection[field],
    new Set(["enabled"]),
    field,
  );
  if (rule.enabled !== expected) {
    throw new Error(`${field}.enabled must be ${expected}`);
  }
}

function assertBooleanRuleShape(protection, field) {
  const rule = assertClosedObject(
    protection[field],
    new Set(["enabled"]),
    field,
  );
  if (typeof rule.enabled !== "boolean") {
    throw new Error(`${field}.enabled must be boolean`);
  }
}

function normalizeProtectedBranch(baseRef) {
  const branch = String(baseRef || "")
    .replace(/^refs\/heads\//, "")
    .replace(/^origin\//, "");
  if (!branch || branch.includes("..") || branch.startsWith("-")) {
    throw new Error(`protected base '${baseRef || ""}' is invalid`);
  }
  return branch;
}

function assertUrlBooleanRule(protection, field, expected) {
  const rule = assertClosedObject(
    protection[field],
    new Set(["url", "enabled"]),
    field,
  );
  if (typeof rule.url !== "string" || rule.enabled !== expected) {
    throw new Error(`${field} is not explicitly ${expected}`);
  }
}

function assertEmptyActors(value, label) {
  if (value === undefined || value === null) return;
  const actors = assertClosedObject(
    value,
    new Set(["users", "teams", "apps"]),
    label,
  );
  for (const key of ["users", "teams", "apps"]) {
    if (
      actors[key] !== undefined &&
      (!Array.isArray(actors[key]) || actors[key].length !== 0)
    ) {
      throw new Error(`${label}.${key} must be empty`);
    }
  }
}

function requiredChecks(protection) {
  const status = assertClosedObject(
    protection.required_status_checks,
    new Set(["url", "strict", "contexts", "contexts_url", "checks"]),
    "required_status_checks",
  );
  if (
    typeof status.url !== "string" ||
    typeof status.contexts_url !== "string" ||
    status.strict !== false ||
    !Array.isArray(status.contexts) ||
    !Array.isArray(status.checks) ||
    status.contexts.length === 0 ||
    status.contexts.length !== status.checks.length
  ) {
    throw new Error(
      "required_status_checks must be complete, non-empty, and strict:false",
    );
  }
  const contexts = status.contexts;
  if (
    contexts.some((context) => typeof context !== "string" || !context) ||
    new Set(contexts).size !== contexts.length
  ) {
    throw new Error(
      "required status contexts must be unique non-empty strings",
    );
  }
  const checks = status.checks.map((check) => {
    const closed = assertClosedObject(
      check,
      new Set(["context", "app_id"]),
      "required status check",
    );
    if (
      !contexts.includes(closed.context) ||
      !Number.isInteger(closed.app_id) ||
      closed.app_id !== GITHUB_ACTIONS_APP_ID
    ) {
      throw new Error(
        "every waived required status check must be bound to the GitHub Actions App",
      );
    }
    return { context: closed.context, appId: closed.app_id };
  });
  if (new Set(checks.map((check) => check.context)).size !== checks.length) {
    throw new Error(
      "required status checks must bind each context exactly once",
    );
  }
  return checks;
}

function assertReviewRule(protection) {
  const rule = protection.required_pull_request_reviews;
  if (rule === undefined || rule === null) return;
  const closed = assertClosedObject(
    rule,
    new Set([
      "url",
      "dismiss_stale_reviews",
      "require_code_owner_reviews",
      "require_last_push_approval",
      "required_approving_review_count",
      "dismissal_restrictions",
      "bypass_pull_request_allowances",
    ]),
    "required_pull_request_reviews",
  );
  if (
    typeof closed.url !== "string" ||
    typeof closed.dismiss_stale_reviews !== "boolean" ||
    closed.require_code_owner_reviews !== false ||
    closed.require_last_push_approval !== false ||
    closed.required_approving_review_count !== 0
  ) {
    throw new Error("pull request review protection is not inert");
  }
  assertEmptyActors(closed.dismissal_restrictions, "dismissal_restrictions");
  assertEmptyActors(
    closed.bypass_pull_request_allowances,
    "bypass_pull_request_allowances",
  );
}

function assertConversationRule(protection, reviewThreads) {
  const rule = assertClosedObject(
    protection.required_conversation_resolution,
    new Set(["enabled"]),
    "required_conversation_resolution",
  );
  if (typeof rule.enabled !== "boolean") {
    throw new Error("required_conversation_resolution.enabled is missing");
  }
  if (!rule.enabled) return;
  const connection = assertClosedObject(
    reviewThreads,
    new Set(["pageInfo", "nodes"]),
    "conversation resolution evidence",
  );
  const pageInfo = assertClosedObject(
    connection.pageInfo,
    new Set(["hasNextPage"]),
    "conversation pageInfo",
  );
  if (pageInfo.hasNextPage !== false || !Array.isArray(connection.nodes)) {
    throw new Error(
      "conversation resolution evidence is incomplete or paginated",
    );
  }
  for (const thread of connection.nodes) {
    const closed = assertClosedObject(
      thread,
      new Set(["isResolved"]),
      "review thread",
    );
    if (closed.isResolved !== true) {
      throw new Error(
        "an exact pull request review conversation is unresolved",
      );
    }
  }
}

function classifyProtectedNonstrict({
  protection,
  effectiveRules,
  reviewThreads,
  repositoryAdmin,
}) {
  const closed = assertClosedObject(
    protection,
    TOP_LEVEL_FIELDS,
    "classic branch protection",
  );
  if (repositoryAdmin !== true) {
    throw new Error("authenticated actor is not a repository administrator");
  }
  if (!Array.isArray(effectiveRules) || effectiveRules.length !== 0) {
    throw new Error("effective rulesets are present or unavailable");
  }
  if (closed.restrictions !== undefined && closed.restrictions !== null) {
    throw new Error("push restrictions are present");
  }
  const checks = requiredChecks(closed);
  assertReviewRule(closed);
  assertUrlBooleanRule(closed, "required_signatures", false);
  assertUrlBooleanRule(closed, "enforce_admins", false);
  // Both values are safe: ref-CAS creates no merge commit and moves the base
  // directly to an existing descendant. Require an explicit boolean shape.
  assertBooleanRuleShape(closed, "required_linear_history");
  assertBooleanRule(closed, "allow_force_pushes", false);
  assertBooleanRule(closed, "allow_deletions", false);
  assertBooleanRule(closed, "block_creations", false);
  assertConversationRule(closed, reviewThreads);
  assertBooleanRule(closed, "lock_branch", false);
  if (closed.allow_fork_syncing !== undefined) {
    assertBooleanRule(closed, "allow_fork_syncing", false);
  }
  const digestInput = canonicalJson({
    protection: closed,
    effectiveRules,
    reviewThreads:
      closed.required_conversation_resolution.enabled === true
        ? reviewThreads
        : null,
  });
  return {
    eligible: true,
    digest: crypto
      .createHash("sha256")
      .update(JSON.stringify(digestInput))
      .digest("hex"),
    requiredChecks: checks,
    conversationResolutionRequired:
      closed.required_conversation_resolution.enabled,
  };
}

function ghJson(args, label, cwd) {
  const result = spawnSync("gh", args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed: ${result.stderr || "gh returned no error"}`.trim(),
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned malformed JSON`, { cause: error });
  }
}

function assertInspectionIdentity(repository, branch, pr) {
  if (!/^[^/]+\/[^/]+$/.test(repository || "")) {
    throw new Error("repository identity is invalid");
  }
  if (normalizeProtectedBranch(branch) !== branch) {
    throw new Error("base branch identity is invalid");
  }
  if (!Number.isInteger(Number(pr)) || Number(pr) < 1) {
    throw new Error("pull request identity is invalid");
  }
}

function reviewThreadsFor(repository, pr, cwd) {
  const [owner, name] = repository.split("/");
  const response = ghJson(
    [
      "api",
      "graphql",
      "-f",
      "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}}}}",
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${Number(pr)}`,
    ],
    "review conversation read",
    cwd,
  );
  return response?.data?.repository?.pullRequest?.reviewThreads;
}

function inspectProtectedNonstrict({ repository, branch, pr, cwd }) {
  assertInspectionIdentity(repository, branch, pr);
  const encoded = encodeURIComponent(branch);
  const protection = ghJson(
    ["api", `repos/${repository}/branches/${encoded}/protection`],
    "classic branch protection read",
    cwd,
  );
  const effectiveRules = ghJson(
    ["api", `repos/${repository}/rules/branches/${encoded}`],
    "effective rules read",
    cwd,
  );
  const repositoryInfo = ghJson(
    ["api", `repos/${repository}`],
    "repository permission read",
    cwd,
  );
  const reviewThreads =
    protection.required_conversation_resolution?.enabled === true
      ? reviewThreadsFor(repository, pr, cwd)
      : null;
  return classifyProtectedNonstrict({
    protection,
    effectiveRules,
    reviewThreads,
    repositoryAdmin: repositoryInfo?.permissions?.admin,
  });
}

function main() {
  const [command, ...raw] = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < raw.length; index += 2) {
    if (!raw[index].startsWith("--")) throw new Error("invalid argument");
    options[raw[index].slice(2)] = raw[index + 1];
  }
  if (command !== "inspect")
    throw new Error(`unknown command '${command || ""}'`);
  const result = inspectProtectedNonstrict({
    repository: options.repo,
    branch: options.branch,
    pr: options.pr,
    cwd: process.cwd(),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality protected non-strict: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  GITHUB_ACTIONS_APP_ID,
  classifyProtectedNonstrict,
  inspectProtectedNonstrict,
  normalizeProtectedBranch,
};
