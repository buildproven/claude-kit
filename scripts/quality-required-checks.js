#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertDispatchNonceAvailable,
  signDispatchAuthorization,
  signingKeyFromEnvironment,
} = require("./quality-review-evidence.js");

const ACCEPTED_CONCLUSIONS = new Set(["success"]);
const PROTECTED_CHECKS = Object.freeze({
  "secret-history-scan": Object.freeze({
    runPrefix: "secret-history-scan:",
    workflowPath: ".github/workflows/secret-history-scan.yml",
    eventType: "secret-history-scan",
  }),
  "harness-summary": Object.freeze({
    runPrefix: "harness-summary:",
    workflowPath: ".github/workflows/harness-gate.yml",
    eventType: "harness-summary",
  }),
});

function protectedCheckConfig(requirement) {
  return PROTECTED_CHECKS[requirement.context] || null;
}

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

function runGh(args, input = undefined) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    input,
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

function dispatchClaimDirectory() {
  const configured = process.env.QUALITY_REVIEW_DISPATCH_CLAIM_DIR;
  const stateHome =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const directory =
    configured || path.join(stateHome, "claude-kit", "dispatch-claims");
  if (!path.isAbsolute(directory))
    throw new Error("dispatch claim directory must be an absolute path");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("dispatch claim directory must be a real directory");
  if (typeof process.geteuid === "function" && stat.uid !== process.geteuid())
    throw new Error("dispatch claim directory has the wrong owner");
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync(directory);
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function claimDispatchNonce({ repository, eventType, head, base, nonce }) {
  const fields = {
    schemaVersion: 1,
    repository,
    eventType,
    head,
    base,
    nonce,
    issuedAt: new Date(0).toISOString(),
    expiresAt: new Date(15 * 60 * 1000).toISOString(),
  };
  const externalId = assertDispatchNonceAvailable(fields, []);
  const claimName = crypto
    .createHash("sha256")
    .update(`${repository}\u0000${externalId}`)
    .digest("hex");
  const directory = dispatchClaimDirectory();
  const claimPath = path.join(directory, `${claimName}.json`);
  let descriptor;
  try {
    descriptor = fs.openSync(claimPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        `dispatch authorization nonce has already been claimed: ${externalId}`,
        { cause: error },
      );
    throw error;
  }
  try {
    const record = {
      schemaVersion: 1,
      repository,
      eventType,
      head: head.toLowerCase(),
      base: base.toLowerCase(),
      nonce,
      externalId,
      claimedAt: new Date().toISOString(),
    };
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(directory);
  return { externalId, claimPath };
}

function claimRemoteDispatchNonce(repository, eventType, head, externalId) {
  // GitHub's Git-ref creation is the durable conditional-create primitive:
  // the first caller creates this immutable tag, and a concurrent or later
  // caller receives HTTP 422 because the ref already exists. A list-then-
  // create check-run marker would leave a cross-host race.
  const claimRef = `refs/tags/buildproven-dispatch-claim/${crypto
    .createHash("sha256")
    .update(`${eventType}\u0000${externalId}`)
    .digest("hex")}`;
  try {
    runGh([
      "api",
      "--method",
      "POST",
      `repos/${repository}/git/refs`,
      "-f",
      `ref=${claimRef}`,
      "-f",
      `sha=${head}`,
    ]);
  } catch (error) {
    if (
      /HTTP 422|already exists|Reference already exists/i.test(
        `${error.message}\n${error.stderr || ""}`,
      )
    )
      throw new Error(
        `dispatch authorization nonce has already been claimed remotely: ${externalId}`,
        { cause: error },
      );
    throw new Error(
      `could not create durable dispatch nonce claim ref ${claimRef}`,
      { cause: error },
    );
  }
  return claimRef;
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

function graphqlRequirements(repository, base) {
  const separator = repository.indexOf("/");
  const owner = repository.slice(0, separator);
  const name = repository.slice(separator + 1);
  const query =
    "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
    "branchProtectionRules(first:100){pageInfo{hasNextPage}nodes{" +
    "requiredStatusCheckContexts matchingRefs(first:100){pageInfo{hasNextPage}" +
    "nodes{name}}}}}}";
  let response;
  try {
    response = JSON.parse(
      runGh([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `name=${name}`,
      ]),
    );
  } catch (error) {
    throw new Error("GitHub GraphQL required-check discovery failed", {
      cause: error,
    });
  }
  const protection = response?.data?.repository?.branchProtectionRules;
  if (!protection || protection.pageInfo?.hasNextPage !== false) {
    throw new Error(
      "GitHub GraphQL required-check discovery was incomplete or unavailable",
    );
  }
  const matching = (protection.nodes || []).filter(
    (rule) =>
      rule?.matchingRefs?.pageInfo?.hasNextPage === false &&
      Array.isArray(rule.matchingRefs.nodes) &&
      rule.matchingRefs.nodes.some((ref) => ref?.name === base),
  );
  if (matching.length !== 1) {
    throw new Error(
      "GitHub GraphQL required-check discovery found no unique effective branch rule",
    );
  }
  const contexts = matching[0].requiredStatusCheckContexts;
  if (!Array.isArray(contexts)) {
    throw new Error(
      "GitHub GraphQL required-check discovery returned invalid check contexts",
    );
  }
  const requirements = [];
  for (const context of contexts) addRequirement(requirements, context, null);
  return requirements;
}

function paginatedArray(path, label) {
  const values = [];
  const separator = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 100; page += 1) {
    const response = apiJson(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(response)) {
      throw new Error(`GitHub ${label} response is invalid`);
    }
    values.push(...response);
    if (response.length < 100) return values;
  }
  throw new Error(`GitHub ${label} pagination exceeded 100 pages`);
}

function requiredChecks(repository, base) {
  const encodedBase = encodeURIComponent(base);
  let protection = null;
  let protectionError = null;
  try {
    protection = optionalApiJson(
      `repos/${repository}/branches/${encodedBase}/protection/required_status_checks`,
    );
  } catch (error) {
    protectionError = error;
  }
  let effectiveRules = null;
  let effectiveRulesError = null;
  try {
    effectiveRules = paginatedArray(
      `repos/${repository}/rules/branches/${encodedBase}`,
      "effective-rules",
    );
  } catch (error) {
    effectiveRulesError = error;
  }
  const requirements = classicRequirements(protection);
  for (const requirement of rulesetRequirements(effectiveRules)) {
    addRequirement(requirements, requirement.context, requirement.appId);
  }
  if (
    protectionError ||
    effectiveRulesError ||
    (requirements.length === 0 && protection === null)
  ) {
    let graphql;
    try {
      graphql = graphqlRequirements(repository, base);
    } catch (error) {
      // Preserve the first authoritative REST failure when the independent
      // fallback is also unavailable. Callers need the original status (for
      // example, rate limiting or a provider outage) to choose a safe retry.
      throw protectionError || effectiveRulesError || error;
    }
    for (const requirement of graphql) {
      addRequirement(requirements, requirement.context, requirement.appId);
    }
    if (
      graphql.length === 0 &&
      (protectionError || effectiveRulesError)
    ) {
      throw protectionError || effectiveRulesError;
    }
  }
  if (requirements.length === 0) {
    throw new Error(
      "protected base has no required status checks or its protection could not be read",
    );
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
        (requirement.appId === null || run.app?.id === requirement.appId) &&
        (!requirement.externalId || run.external_id === requirement.externalId),
    )
    .sort((left, right) => Number(right.id || 0) - Number(left.id || 0));
}

function checkState(runs, requirement) {
  const latest = matchingRuns(runs, requirement)[0];
  if (!latest) return { state: "missing", run: null };
  return checkRunState(latest);
}

function checkRunState(latest) {
  if (latest.status !== "completed") return { state: "pending", run: latest };
  return {
    state: ACCEPTED_CONCLUSIONS.has(latest.conclusion) ? "success" : "failed",
    run: latest,
  };
}

function trustedSecretCheckState({
  repository,
  runs,
  requirement,
  workflowId,
  base,
  targetHead,
  baseHead,
}) {
  const protectedConfig = protectedCheckConfig(requirement);
  if (!protectedConfig) return { state: "missing", run: null };
  const latest = matchingRuns(runs, requirement)[0];
  if (!latest || typeof latest.details_url !== "string") {
    return { state: "missing", run: null };
  }
  let workflowRun;
  try {
    workflowRun = workflowRunForCheck(repository, latest);
  } catch {
    return { state: "missing", run: null };
  }
  const noncePrefix = `${protectedConfig.runPrefix}${targetHead}:${baseHead}:`;
  const externalId = String(requirement.externalId || latest.external_id || "");
  if (!externalId.startsWith(noncePrefix)) {
    return { state: "missing", run: null };
  }
  const nonce = externalId.slice(noncePrefix.length);
  if (!/^[0-9a-f]{32}$/.test(nonce)) {
    return { state: "missing", run: null };
  }
  const expectedRunName = `${noncePrefix}${nonce}`;
  if (
    (workflowId !== null && workflowRun.workflow_id !== workflowId) ||
    workflowRun.event !== "repository_dispatch" ||
    workflowRun.head_branch !== base ||
    workflowRun.head_sha !== baseHead ||
    workflowRun.path !== protectedConfig.workflowPath ||
    workflowRun.display_title !== expectedRunName ||
    !["queued", "in_progress", "completed"].includes(workflowRun.status)
  )
    return { state: "missing", run: null };
  if (workflowRun.status !== "completed")
    return { state: "pending", run: latest };
  if (workflowRun.conclusion !== "success")
    return { state: "failed", run: latest };
  return checkRunState(latest);
}

function branchHeadSha(repository, base) {
  const response = apiJson(
    `repos/${repository}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  const sha = response.object?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`GitHub base ref '${base}' did not return a commit SHA`);
  }
  return sha;
}

function workflowIdForRun(repository, run) {
  return workflowRunForCheck(repository, run).workflow_id;
}

function workflowRunForCheck(repository, run) {
  const match = String(run.details_url || "").match(/\/actions\/runs\/(\d+)/);
  if (!match) {
    throw new Error(`required check '${run.name}' has no Actions run identity`);
  }
  const workflowRun = apiJson(`repos/${repository}/actions/runs/${match[1]}`);
  if (!Number.isInteger(workflowRun.workflow_id)) {
    throw new Error(`required check '${run.name}' has no workflow identity`);
  }
  return workflowRun;
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

function dispatchRepositoryEvent(repository, eventType, payload) {
  const issuedAt = new Date();
  const authorization = signDispatchAuthorization(
    {
      schemaVersion: 1,
      repository,
      eventType,
      head: payload.head_sha,
      base: payload.base_sha,
      nonce: payload.nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
    },
    signingKeyFromEnvironment(),
  );
  const authorizedPayload = { ...payload, authorization };
  const claim = claimDispatchNonce({
    repository,
    eventType,
    head: payload.head_sha,
    base: payload.base_sha,
    nonce: payload.nonce,
  });
  if (
    claim.externalId !==
    `${eventType}:${payload.head_sha}:${payload.base_sha}:${payload.nonce}`
  )
    throw new Error("dispatch claim identity mismatch");
  if (process.env.QUALITY_REVIEW_DISPATCH_REMOTE_CLAIM !== "false") {
    claimRemoteDispatchNonce(
      repository,
      eventType,
      payload.head_sha,
      claim.externalId,
    );
  }
  try {
    runGh(
      [
        "api",
        "--method",
        "POST",
        `repos/${repository}/dispatches`,
        "--input",
        "-",
      ],
      JSON.stringify({
        event_type: eventType,
        client_payload: authorizedPayload,
      }),
    );
  } catch (error) {
    // The local and GitHub-backed claims are one-use. Retrying the same
    // signed request after an ambiguous API failure could create a duplicate.
    throw new Error(
      `repository dispatch failed after nonce claim: ${error.message}`,
      { cause: error },
    );
  }
}

function dispatchedRunsForHead(repository, headRef, targetHead, workflowIds) {
  const matching = new Map();
  for (let page = 1; page <= 100; page += 1) {
    const response = apiJson(
      `repos/${repository}/actions/runs?branch=${encodeURIComponent(headRef)}&event=workflow_dispatch&per_page=100&page=${page}`,
    );
    if (!Array.isArray(response.workflow_runs)) {
      throw new Error("GitHub workflow-runs response is invalid");
    }
    for (const run of response.workflow_runs) {
      if (
        run.head_sha === targetHead &&
        run.head_branch === headRef &&
        run.event === "workflow_dispatch" &&
        workflowIds.has(run.workflow_id) &&
        !matching.has(run.workflow_id)
      ) {
        matching.set(run.workflow_id, run);
      }
    }
    if (matching.size === workflowIds.size) return matching;
    if (response.workflow_runs.length < 100) return matching;
  }
  throw new Error("GitHub workflow-runs pagination exceeded 100 pages");
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
  baseRevisionRetry = false,
}) {
  const requirements = requiredChecks(repository, base);
  const sourceRuns = checkRuns(repository, sourceHead);
  let targetRuns = checkRuns(repository, targetHead);
  const protectedCheckRequired = requirements.some(protectedCheckConfig);
  const baseHead = protectedCheckRequired
    ? branchHeadSha(repository, base)
    : null;
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
    const protectedConfig = protectedCheckConfig(requirement);
    if (!protectedConfig) {
      const target = checkState(targetRuns, requirement);
      if (["pending", "success"].includes(target.state)) continue;
    }
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
    if (protectedConfig) {
      const target = trustedSecretCheckState({
        repository,
        runs: targetRuns,
        requirement,
        workflowId,
        base,
        targetHead,
        baseHead,
      });
      if (["pending", "success"].includes(target.state)) continue;
    }
    const dispatchKey = `${workflowId}:${protectedConfig ? "repository_dispatch" : "workflow_dispatch"}`;
    let dispatchedRequirement = requirement;
    if (!dispatchedWorkflowIds.has(dispatchKey)) {
      try {
        if (protectedConfig) {
          const nonce = crypto.randomBytes(16).toString("hex");
          dispatchRepositoryEvent(repository, protectedConfig.eventType, {
            head_sha: targetHead,
            base_sha: baseHead,
            nonce,
          });
          dispatchedRequirement = {
            ...requirement,
            externalId: `${protectedConfig.runPrefix}${targetHead}:${baseHead}:${nonce}`,
          };
        } else {
          dispatchWorkflow(repository, workflowId, headRef);
        }
      } catch (error) {
        targetRuns = checkRuns(repository, targetHead);
        const refreshed = protectedConfig
          ? { state: "missing" }
          : checkState(targetRuns, requirement);
        if (!["pending", "success"].includes(refreshed.state)) throw error;
      }
      dispatchedWorkflowIds.add(dispatchKey);
    }
    dispatched.push({ context: requirement.context, workflowId });
    dispatchedRequirements.push({
      requirement: dispatchedRequirement,
      workflowId,
    });
  }
  const deferred = [];
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
    const missing = dispatchedRequirements.filter((entry) => {
      const state = protectedCheckConfig(entry.requirement)
        ? trustedSecretCheckState({
            repository,
            runs: targetRuns,
            requirement: entry.requirement,
            workflowId: entry.workflowId,
            base,
            targetHead,
            baseHead,
          })
        : checkState(targetRuns, entry.requirement);
      return state.state === "missing";
    });
    const normalWorkflowIds = new Set(
      missing
        .filter((entry) => !protectedCheckConfig(entry.requirement))
        .map((entry) => entry.workflowId),
    );
    const workflowRuns = normalWorkflowIds.size
      ? dispatchedRunsForHead(
          repository,
          headRef,
          targetHead,
          normalWorkflowIds,
        )
      : new Map();
    const unregistered = missing.filter((entry) => {
      if (protectedCheckConfig(entry.requirement)) {
        // Repository-dispatch runs use the default branch metadata. The
        // target check is the only safe correlation signal; do not accept an
        // unrelated or merely active dispatch run as registration evidence.
        return true;
      }
      return !workflowRuns.has(entry.workflowId);
    });
    if (unregistered.length > 0) {
      throw new Error(
        `required checks or their exact-head workflows did not register on stamp ${targetHead} after workflow dispatch: ${unregistered
          .map(
            (entry) =>
              `${entry.requirement.context} (workflow ${entry.workflowId})`,
          )
          .join(", ")}`,
      );
    }
    const completedWithoutContext = missing.filter(
      (entry) => workflowRuns.get(entry.workflowId)?.status === "completed",
    );
    if (completedWithoutContext.length > 0) {
      throw new Error(
        `dispatched workflows completed without required checks on stamp ${targetHead}: ${completedWithoutContext
          .map(
            (entry) =>
              `${entry.requirement.context} (workflow ${entry.workflowId})`,
          )
          .join(", ")}`,
      );
    }
    for (const entry of missing) {
      const run = workflowRuns.get(entry.workflowId);
      deferred.push({
        context: entry.requirement.context,
        workflowId: entry.workflowId,
        runId: run.id,
        status: run.status,
      });
    }
  }
  if (protectedCheckRequired) {
    const currentBaseHead = branchHeadSha(repository, base);
    if (currentBaseHead !== baseHead) {
      if (baseRevisionRetry) {
        throw new Error(
          `protected scan base branch '${base}' changed during preparation from ${baseHead} to ${currentBaseHead}; retry after the base settles`,
        );
      }
      return ensureChecks({
        repository,
        base,
        sourceHead,
        targetHead,
        headRef,
        registrationSeconds,
        registrationIntervalSeconds,
        baseRevisionRetry: true,
      });
    }
  }
  return { requirements, dispatched, deferred };
}

function inspectChecks(repository, base, head) {
  const requirements = requiredChecks(repository, base);
  const runs = checkRuns(repository, head);
  const baseHead = requirements.some(protectedCheckConfig)
    ? branchHeadSha(repository, base)
    : null;
  return requirements.map((requirement) => ({
    ...requirement,
    ...(protectedCheckConfig(requirement)
      ? trustedSecretCheckState({
          repository,
          runs,
          requirement,
          workflowId: null,
          base,
          targetHead: head,
          baseHead,
        })
      : checkState(runs, requirement)),
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
  claimDispatchNonce,
  claimRemoteDispatchNonce,
  dispatchedRunsForHead,
  ensureChecks,
  matchingRuns,
  requiredChecks,
  graphqlRequirements,
  trustedSecretCheckState,
  waitForChecks,
};
