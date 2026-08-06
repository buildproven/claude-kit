#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const ACCEPTED_CONCLUSIONS = new Set(["success"]);

class GhCommandError extends Error {
  constructor(message, result) {
    super(message);
    this.exitStatus = result.status;
    this.stdout = result.stdout || "";
    this.stderr = result.stderr || "";
  }
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name.startsWith("--"))
      throw new Error(`unexpected argument '${name}'`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

function requiredOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function validateRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("repository must be owner/name");
  }
  return value;
}

function validateSha(value, name) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${name} must be a SHA`);
  return value;
}

function validateRef(value, name) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.includes("..") ||
    value.endsWith("/")
  ) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function runGh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new GhCommandError(
      `gh ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`,
      result,
    );
  }
  return result.stdout;
}

function runGit(args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `git ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return result.stdout;
}

function apiJson(path) {
  const output = runGh(["api", "-X", "GET", path]);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`GitHub API returned invalid JSON for ${path}`, {
      cause: error,
    });
  }
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function optionalApiJson(path) {
  try {
    return apiJson(path);
  } catch (error) {
    if (error instanceof GhCommandError) {
      const body = parseJsonOrNull(error.stdout);
      if (
        error.stderr.includes("(HTTP 404)") &&
        body?.message === "Branch not protected"
      ) {
        return null;
      }
    }
    throw error;
  }
}

function addRequirement(requirements, context, appId) {
  if (typeof context !== "string" || context.length === 0) return;
  const parsedAppId = Number(appId);
  const normalizedAppId =
    Number.isInteger(parsedAppId) && parsedAppId > 0 ? parsedAppId : null;
  if (
    !requirements.some(
      (requirement) =>
        requirement.context === context &&
        requirement.appId === normalizedAppId,
    )
  ) {
    requirements.push({ context, appId: normalizedAppId });
  }
}

function classicRequirements(protection) {
  const requirements = [];
  if (protection === null) return requirements;
  if (typeof protection !== "object" || Array.isArray(protection)) {
    throw new Error("GitHub branch-protection response is invalid");
  }
  const checks = Array.isArray(protection.checks) ? protection.checks : [];
  const contexts = Array.isArray(protection.contexts)
    ? protection.contexts
    : [];
  for (const check of checks) {
    addRequirement(requirements, check.context, check.app_id);
  }
  for (const context of contexts) {
    if (!requirements.some((requirement) => requirement.context === context)) {
      addRequirement(requirements, context, null);
    }
  }
  return requirements;
}

function rulesetRequirements(effectiveRules) {
  const requirements = [];
  if (effectiveRules !== null && !Array.isArray(effectiveRules)) {
    throw new Error("GitHub effective-rules response is invalid");
  }
  for (const rule of effectiveRules || []) {
    if (rule?.type !== "required_status_checks") continue;
    const checks = rule.parameters?.required_status_checks;
    if (!Array.isArray(checks)) continue;
    for (const check of checks) {
      addRequirement(requirements, check.context, check.integration_id);
    }
  }
  return requirements;
}

function requiredChecks(repository, base) {
  const encodedBase = encodeURIComponent(base);
  const protection = optionalApiJson(
    `repos/${repository}/branches/${encodedBase}/protection/required_status_checks`,
  );
  const effectiveRules = apiJson(
    `repos/${repository}/rules/branches/${encodedBase}`,
  );
  const requirements = classicRequirements(protection);
  for (const requirement of rulesetRequirements(effectiveRules)) {
    addRequirement(requirements, requirement.context, requirement.appId);
  }
  if (requirements.length === 0) {
    throw new Error("protected base has no required status checks");
  }
  return requirements;
}

function checkRuns(repository, head) {
  const runs = [];
  let totalCount = null;
  for (let page = 1; page <= 100; page += 1) {
    const response = apiJson(
      `repos/${repository}/commits/${head}/check-runs?per_page=100&page=${page}`,
    );
    if (!Array.isArray(response.check_runs)) {
      throw new Error("GitHub check-runs response is invalid");
    }
    if (page === 1) {
      if (response.total_count === undefined) return response.check_runs;
      if (!Number.isInteger(response.total_count) || response.total_count < 0) {
        throw new Error("GitHub check-runs total_count is invalid");
      }
      totalCount = response.total_count;
    }
    runs.push(...response.check_runs);
    if (runs.length >= totalCount) return runs;
    if (response.check_runs.length === 0) {
      throw new Error("GitHub check-runs pagination ended before total_count");
    }
  }
  throw new Error("GitHub check-runs pagination exceeded 100 pages");
}

function matchingRuns(runs, requirement) {
  return runs
    .filter(
      (run) =>
        run.name === requirement.context &&
        (requirement.appId === null || run.app?.id === requirement.appId),
    )
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
}

function checkState(runs, requirement) {
  const latest = matchingRuns(runs, requirement)[0];
  if (!latest) return { state: "missing", run: null };
  if (latest.status !== "completed") return { state: "pending", run: latest };
  return {
    state: ACCEPTED_CONCLUSIONS.has(latest.conclusion) ? "success" : "failed",
    run: latest,
  };
}

function workflowIdForRun(repository, run) {
  const match = String(run.details_url || "").match(/\/actions\/runs\/(\d+)/);
  if (!match) {
    throw new Error(`required check '${run.name}' has no Actions run identity`);
  }
  const workflowRun = apiJson(`repos/${repository}/actions/runs/${match[1]}`);
  if (!Number.isInteger(workflowRun.workflow_id)) {
    throw new Error(`required check '${run.name}' has no workflow identity`);
  }
  return workflowRun.workflow_id;
}

function sourceRunForRequirement(
  repository,
  sourceHead,
  sourceRuns,
  requirement,
) {
  const exact = matchingRuns(sourceRuns, requirement)[0];
  if (exact) return exact;
  const ancestors = runGit([
    "rev-list",
    "--first-parent",
    "--max-count=100",
    sourceHead,
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(1);
  for (const ancestor of ancestors) {
    const historical = matchingRuns(
      checkRuns(repository, ancestor),
      requirement,
    )[0];
    if (historical) return historical;
  }
  return null;
}

function dispatchWorkflow(repository, workflowId, ref) {
  let failure = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      runGh([
        "api",
        "--method",
        "POST",
        `repos/${repository}/actions/workflows/${workflowId}/dispatches`,
        "-f",
        `ref=${ref}`,
      ]);
      return;
    } catch (error) {
      failure = error;
      if (attempt < 3) sleep(attempt * 1000);
    }
  }
  throw failure;
}

function waitForRegistration({
  repository,
  targetHead,
  requirements,
  targetRuns,
  timeoutSeconds,
  intervalSeconds,
}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let runs = targetRuns;
  while (
    requirements.some(
      (requirement) => checkState(runs, requirement).state === "missing",
    ) &&
    Date.now() < deadline
  ) {
    sleep(intervalSeconds * 1000);
    runs = checkRuns(repository, targetHead);
  }
  return runs;
}

function ensureChecks({
  repository,
  base,
  sourceHead,
  targetHead,
  headRef,
  registrationSeconds = 30,
  registrationIntervalSeconds = 2,
}) {
  const requirements = requiredChecks(repository, base);
  const sourceRuns = checkRuns(repository, sourceHead);
  let targetRuns = checkRuns(repository, targetHead);
  targetRuns = waitForRegistration({
    repository,
    targetHead,
    requirements,
    targetRuns,
    timeoutSeconds: registrationSeconds,
    intervalSeconds: registrationIntervalSeconds,
  });
  const dispatched = [];
  const dispatchedRequirements = [];
  const dispatchedWorkflowIds = new Set();
  for (const requirement of requirements) {
    const target = checkState(targetRuns, requirement);
    if (["pending", "success"].includes(target.state)) continue;
    const source = sourceRunForRequirement(
      repository,
      sourceHead,
      sourceRuns,
      requirement,
    );
    if (!source) {
      throw new Error(
        `cannot map required check '${requirement.context}' to a workflow from the reviewed head or its first-parent history`,
      );
    }
    const workflowId = workflowIdForRun(repository, source);
    if (!dispatchedWorkflowIds.has(workflowId)) {
      try {
        dispatchWorkflow(repository, workflowId, headRef);
      } catch (error) {
        targetRuns = checkRuns(repository, targetHead);
        const refreshed = checkState(targetRuns, requirement);
        if (!["pending", "success"].includes(refreshed.state)) throw error;
      }
      dispatchedWorkflowIds.add(workflowId);
    }
    dispatched.push({ context: requirement.context, workflowId });
    dispatchedRequirements.push({ requirement, workflowId });
  }
  if (dispatched.length > 0) {
    targetRuns = checkRuns(repository, targetHead);
    targetRuns = waitForRegistration({
      repository,
      targetHead,
      requirements: dispatchedRequirements.map((entry) => entry.requirement),
      targetRuns,
      timeoutSeconds: registrationSeconds,
      intervalSeconds: registrationIntervalSeconds,
    });
    const missing = dispatchedRequirements.filter(
      (entry) => checkState(targetRuns, entry.requirement).state === "missing",
    );
    if (missing.length > 0) {
      throw new Error(
        `required checks did not register on stamp ${targetHead} after workflow dispatch: ${missing
          .map(
            (entry) =>
              `${entry.requirement.context} (workflow ${entry.workflowId})`,
          )
          .join(", ")}`,
      );
    }
  }
  return { requirements, dispatched };
}

function inspectChecks(repository, base, head) {
  const requirements = requiredChecks(repository, base);
  const runs = checkRuns(repository, head);
  return requirements.map((requirement) => ({
    ...requirement,
    ...checkState(runs, requirement),
  }));
}

function assertChecks(repository, base, head) {
  const states = inspectChecks(repository, base, head);
  const incomplete = states.filter((entry) => entry.state !== "success");
  if (incomplete.length > 0) {
    throw new Error(
      `required exact-head checks are not successful: ${incomplete
        .map((entry) => `${entry.context}=${entry.state}`)
        .join(", ")}`,
    );
  }
  return states;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForChecks({
  repository,
  base,
  head,
  timeoutSeconds,
  intervalSeconds,
  failureGraceSeconds = 90,
}) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutSeconds * 1000;
  let states = [];
  while (Date.now() < deadline) {
    states = inspectChecks(repository, base, head);
    if (states.every((entry) => entry.state === "success")) return states;
    const failed = states.filter((entry) => entry.state === "failed");
    if (
      failed.length > 0 &&
      Date.now() - startedAt >= failureGraceSeconds * 1000
    ) {
      throw new Error(
        `required exact-head checks failed: ${failed
          .map((entry) => entry.context)
          .join(", ")}`,
      );
    }
    process.stderr.write(
      `[quality] exact-head checks pending: ${states
        .filter((entry) => entry.state !== "success")
        .map((entry) => `${entry.context}=${entry.state}`)
        .join(", ")}\n`,
    );
    sleep(intervalSeconds * 1000);
  }
  throw new Error(
    `timed out waiting for exact-head required checks: ${states
      .filter((entry) => entry.state !== "success")
      .map((entry) => `${entry.context}=${entry.state}`)
      .join(", ")}`,
  );
}

function commandContext(options) {
  return {
    repository: validateRepository(requiredOption(options, "repo")),
    base: validateRef(requiredOption(options, "base"), "base"),
    head: validateSha(requiredOption(options, "head"), "head"),
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === "ensure") {
    const context = commandContext(options);
    const registrationSeconds = Number.parseInt(
      options["registration-timeout"] || "30",
      10,
    );
    if (!Number.isInteger(registrationSeconds) || registrationSeconds < 0) {
      throw new Error("--registration-timeout must be non-negative seconds");
    }
    const result = ensureChecks({
      ...context,
      sourceHead: validateSha(
        requiredOption(options, "source-head"),
        "source-head",
      ),
      targetHead: context.head,
      headRef: validateRef(requiredOption(options, "head-ref"), "head-ref"),
      registrationSeconds,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "assert") {
    const context = commandContext(options);
    process.stdout.write(
      `${JSON.stringify(assertChecks(context.repository, context.base, context.head))}\n`,
    );
    return;
  }
  if (command === "wait") {
    const context = commandContext(options);
    const timeout = Number.parseInt(requiredOption(options, "timeout"), 10);
    const interval = Number.parseInt(options.interval || "10", 10);
    const failureGrace = Number.parseInt(options["failure-grace"] || "90", 10);
    if (!Number.isInteger(timeout) || timeout < 1) {
      throw new Error("--timeout must be positive seconds");
    }
    if (!Number.isInteger(interval) || interval < 1) {
      throw new Error("--interval must be positive seconds");
    }
    if (!Number.isInteger(failureGrace) || failureGrace < 0) {
      throw new Error("--failure-grace must be non-negative seconds");
    }
    process.stdout.write(
      `${JSON.stringify(
        waitForChecks({
          repository: context.repository,
          base: context.base,
          head: context.head,
          timeoutSeconds: timeout,
          intervalSeconds: interval,
          failureGraceSeconds: failureGrace,
        }),
      )}\n`,
    );
    return;
  }
  throw new Error("usage: quality-required-checks.js <ensure|wait|assert> ...");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`quality required checks: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertChecks,
  checkRuns,
  checkState,
  ensureChecks,
  matchingRuns,
  requiredChecks,
  waitForChecks,
};
