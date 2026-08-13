#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROUTES = [
  "economy-micro",
  "economy-builder",
  "standard",
  "expert",
  "critical",
];
const SENSITIVE_RECORD_KEYS = new Set([
  "prompt",
  "promptBody",
  "credentials",
  "secret",
  "token",
  "apiKey",
]);
const FACT_KEYS = new Set([
  "provider",
  "phase",
  "readOnly",
  "localized",
  "reversible",
  "targetedProof",
  "ambiguous",
  "changedFiles",
  "protectedSurfaces",
  "sameFailureStreak",
  "publicContract",
  "crossRepository",
  "operatorRoute",
]);
const BOOLEAN_FACT_KEYS = new Set([
  "readOnly",
  "localized",
  "reversible",
  "targetedProof",
  "ambiguous",
  "publicContract",
  "crossRepository",
]);
const EXECUTION_BINDING_KEYS = [
  "schemaVersion",
  "policyVersion",
  "promptSha256",
  "targetIdentitySha256",
  "targetHead",
  "classifiedProtectedSurfaces",
];

function policyPath() {
  return path.join(__dirname, "..", "config", "compute-governor-policy.json");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`compute-governor: invalid JSON in ${label}`, {
      cause: error,
    });
  }
}

function routePolicyValid(routePolicy) {
  const providerValid = (provider, mapping) => {
    if (
      !mapping ||
      typeof mapping.model !== "string" ||
      mapping.model.trim().length === 0 ||
      mapping.model !== mapping.model.trim()
    )
      return false;
    const efforts =
      provider === "codex"
        ? ["low", "medium", "high", "xhigh"]
        : [null, "low", "medium", "high"];
    return efforts.includes(mapping.effort);
  };
  return Boolean(
    providerValid("codex", routePolicy?.providers?.codex) &&
    providerValid("claude", routePolicy?.providers?.claude) &&
    Number.isInteger(routePolicy.caps?.maxWallSeconds) &&
    routePolicy.caps.maxWallSeconds > 0 &&
    routePolicy.caps.maxWorkers === 1,
  );
}

function loadPolicy(file = policyPath()) {
  const policy = parseJson(fs.readFileSync(file, "utf8"), "policy");
  requireCondition(
    policy.schemaVersion === 1 &&
      typeof policy.policyVersion === "string" &&
      policy.policyVersion.length > 0 &&
      policy.routes &&
      Array.isArray(policy.protectedSurfaces) &&
      policy.protectedPromptPatterns,
    "compute-governor: unsupported policy schema version",
  );
  for (const route of ROUTES) {
    requireCondition(
      routePolicyValid(policy.routes[route]),
      `compute-governor: policy missing route '${route}'`,
    );
  }
  const patternSurfaces = Object.keys(policy.protectedPromptPatterns).sort();
  const protectedSurfaces = [...policy.protectedSurfaces].sort();
  requireCondition(
    JSON.stringify(patternSurfaces) === JSON.stringify(protectedSurfaces) &&
      patternSurfaces.every((surface) => {
        const patterns = policy.protectedPromptPatterns[surface];
        return (
          Array.isArray(patterns) &&
          patterns.length > 0 &&
          patterns.every(
            (pattern) => typeof pattern === "string" && pattern.length > 0,
          )
        );
      }),
    "compute-governor: protected prompt policy must exactly cover protected surfaces",
  );
  return policy;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function targetHead(targetDir) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "unversioned";
  }
}

function requireCleanVersionedTarget(targetDir) {
  const head = targetHead(targetDir);
  requireCondition(
    head !== "unversioned",
    "compute-governor: governed target must be a versioned git worktree",
  );
  const status = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: targetDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  requireCondition(
    status.length === 0,
    "compute-governor: governed target worktree must be clean",
  );
  return head;
}

function classifiedProtectedSurfaces(prompt, policy) {
  return Object.entries(policy.protectedPromptPatterns)
    .filter(([surface, patterns]) => {
      requireCondition(
        policy.protectedSurfaces.includes(surface) &&
          Array.isArray(patterns) &&
          patterns.length > 0 &&
          patterns.every((pattern) => typeof pattern === "string"),
        `compute-governor: invalid protected prompt policy for '${surface}'`,
      );
      return patterns.some((pattern) => new RegExp(pattern, "iu").test(prompt));
    })
    .map(([surface]) => surface)
    .sort();
}

function executionBinding(promptFile, targetDir, policy = loadPolicy()) {
  const prompt = fs.readFileSync(promptFile);
  const target = fs.realpathSync(targetDir);
  return {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    promptSha256: sha256(prompt),
    targetIdentitySha256: sha256(target),
    targetHead: requireCleanVersionedTarget(target),
    classifiedProtectedSurfaces: classifiedProtectedSurfaces(
      prompt.toString("utf8"),
      policy,
    ),
  };
}

function resolveExecution(facts, promptFile, targetDir, policy = loadPolicy()) {
  assertFacts(facts, policy);
  const binding = executionBinding(promptFile, targetDir, policy);
  const declared = facts.protectedSurfaces ?? [];
  const protectedSurfaces = [
    ...new Set([...declared, ...binding.classifiedProtectedSurfaces]),
  ].sort();
  return {
    ...resolveLaunch({ ...facts, protectedSurfaces }, policy),
    executionBinding: binding,
  };
}

function resolveLaunch(facts, policy = loadPolicy()) {
  const candidate = resolve(facts, policy);
  if (!candidate.route.startsWith("economy")) return candidate;
  const mapping = policy.routes.standard.providers[candidate.provider];
  return {
    ...candidate,
    route: "standard",
    model: mapping.model,
    effort: mapping.effort,
    caps: policy.routes.standard.caps,
    reasons: [
      ...candidate.reasons,
      "economy candidate lacks approved calibration",
    ],
    promotion: "calibration-required-standard-fallback",
  };
}

function rank(route) {
  const result = ROUTES.indexOf(route);
  if (result === -1)
    throw new Error(`compute-governor: invalid route '${route}'`);
  return result;
}

function atLeast(current, candidate) {
  return rank(candidate) > rank(current) ? candidate : current;
}

function protectedSurfacesValid(facts, policy) {
  const surfaces = facts.protectedSurfaces ?? [];
  return (
    Array.isArray(surfaces) &&
    surfaces.every(
      (surface) =>
        typeof surface === "string" &&
        policy.protectedSurfaces.includes(surface),
    )
  );
}

function scalarFactsValid(facts) {
  const changedFilesValid =
    facts.changedFiles === undefined ||
    (Number.isInteger(facts.changedFiles) && facts.changedFiles >= 0);
  const failureStreakValid =
    facts.sameFailureStreak === undefined ||
    (Number.isInteger(facts.sameFailureStreak) && facts.sameFailureStreak >= 0);
  const operatorRouteValid =
    facts.operatorRoute === undefined || ROUTES.includes(facts.operatorRoute);
  const booleansValid = [...BOOLEAN_FACT_KEYS].every(
    (key) => facts[key] === undefined || typeof facts[key] === "boolean",
  );
  return (
    changedFilesValid &&
    failureStreakValid &&
    operatorRouteValid &&
    booleansValid
  );
}

function assertFacts(facts, policy) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    throw new Error("compute-governor: facts must be an object");
  }
  if (!["codex", "claude"].includes(facts.provider)) {
    throw new Error("compute-governor: facts.provider must be codex or claude");
  }
  if (
    !["scan", "implement", "test", "review", "diagnose"].includes(facts.phase)
  ) {
    throw new Error("compute-governor: facts.phase is invalid");
  }
  if (!protectedSurfacesValid(facts, policy)) {
    throw new Error("compute-governor: facts.protectedSurfaces is invalid");
  }
  if (!scalarFactsValid(facts)) {
    throw new Error("compute-governor: numeric or route facts are invalid");
  }
  const unsupported = Object.keys(facts).filter((key) => !FACT_KEYS.has(key));
  if (unsupported.length > 0) {
    throw new Error(
      `compute-governor: unsupported execution fact '${unsupported[0]}'`,
    );
  }
}

function canonicalFacts(facts) {
  return Object.fromEntries(
    [...FACT_KEYS]
      .filter((key) => facts[key] !== undefined)
      .sort()
      .map((key) => [key, facts[key]]),
  );
}

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

function safetyFloor(facts, policy) {
  const surfaces = Array.isArray(facts.protectedSurfaces)
    ? facts.protectedSurfaces
    : [];
  const protectedHit = surfaces.find((surface) =>
    policy.protectedSurfaces.includes(surface),
  );
  if (protectedHit)
    return { route: "critical", reason: `protected surface: ${protectedHit}` };
  if (facts.publicContract === true || facts.crossRepository === true) {
    return {
      route: "critical",
      reason: facts.publicContract
        ? "public contract"
        : "cross-repository dependency",
    };
  }
  return { route: "economy-micro", reason: "no protected surface" };
}

function isEconomyBuilder(facts) {
  return (
    facts.localized === true &&
    facts.reversible === true &&
    facts.targetedProof === true &&
    facts.ambiguous !== true &&
    (facts.changedFiles || 1) <= 2
  );
}

function standardReason(facts) {
  if (facts.ambiguous === true) return "ambiguous behavior";
  if (facts.targetedProof !== true)
    return "targeted deterministic proof missing";
  if ((facts.changedFiles || 0) > 5) return "scope exceeds economy cap";
  return "ordinary implementation or test work";
}

function workTier(facts) {
  const attempts = Number.isInteger(facts.sameFailureStreak)
    ? facts.sameFailureStreak
    : 0;
  if (attempts >= 2)
    return { route: "expert", reasons: ["two matching failed attempts"] };
  if (facts.operatorRoute)
    return { route: facts.operatorRoute, reasons: ["operator override"] };
  if (
    facts.phase === "scan" &&
    facts.readOnly === true &&
    facts.localized === true
  ) {
    return { route: "economy-micro", reasons: ["bounded read-only scan"] };
  }
  if (isEconomyBuilder(facts)) {
    return {
      route: "economy-builder",
      reasons: [
        "localized reversible behavior",
        "targeted deterministic proof",
      ],
    };
  }
  return { route: "standard", reasons: [standardReason(facts)] };
}

function resolve(facts, policy = loadPolicy()) {
  assertFacts(facts, policy);
  const boundFacts = canonicalFacts(facts);
  const floor = safetyFloor(facts, policy);
  const work = workTier(facts);
  const route = atLeast(floor.route, work.route);
  const mapping = policy.routes[route].providers[facts.provider];
  return {
    schemaVersion: 1,
    policyVersion: policy.policyVersion,
    route,
    provider: facts.provider,
    model: mapping.model,
    effort: mapping.effort,
    contextClass: "fresh-bounded",
    caps: policy.routes[route].caps,
    safetyFloor: floor.route,
    facts: boundFacts,
    reasons: [floor.reason, ...work.reasons],
    promotion: route.startsWith("economy")
      ? "candidate-requires-calibration"
      : "not-applicable",
  };
}

function planIdentityValid(plan, policy) {
  const mapping = policy.routes[plan.route].providers[plan.provider];
  return (
    plan.policyVersion === policy.policyVersion &&
    plan.model === mapping.model &&
    plan.effort === mapping.effort
  );
}

function planContractValid(plan, policy) {
  const expectedCaps = policy.routes[plan.route].caps;
  const expectedPromotion = plan.executionBinding
    ? resolveLaunch(plan.facts, policy).promotion
    : plan.route.startsWith("economy")
      ? "candidate-requires-calibration"
      : "not-applicable";
  return (
    plan.contextClass === "fresh-bounded" &&
    plan.facts &&
    JSON.stringify(canonicalJson(plan.caps)) ===
      JSON.stringify(canonicalJson(expectedCaps)) &&
    Array.isArray(plan.reasons) &&
    plan.reasons.length > 0 &&
    plan.reasons.every(
      (reason) => typeof reason === "string" && reason.length > 0,
    ) &&
    plan.promotion === expectedPromotion
  );
}

function executionBindingValid(binding, policy) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding))
    return false;
  const keys = Object.keys(binding).sort();
  const expectedKeys = [...EXECUTION_BINDING_KEYS].sort();
  return (
    JSON.stringify(keys) === JSON.stringify(expectedKeys) &&
    binding.schemaVersion === 1 &&
    binding.policyVersion === policy.policyVersion &&
    /^[0-9a-f]{64}$/.test(binding.promptSha256) &&
    /^[0-9a-f]{64}$/.test(binding.targetIdentitySha256) &&
    /^[0-9a-f]{40}$/.test(binding.targetHead) &&
    Array.isArray(binding.classifiedProtectedSurfaces) &&
    binding.classifiedProtectedSurfaces.every(
      (surface) =>
        typeof surface === "string" &&
        policy.protectedSurfaces.includes(surface),
    ) &&
    new Set(binding.classifiedProtectedSurfaces).size ===
      binding.classifiedProtectedSurfaces.length &&
    JSON.stringify(binding.classifiedProtectedSurfaces) ===
      JSON.stringify([...binding.classifiedProtectedSurfaces].sort())
  );
}

function validatePlan(plan, policy = loadPolicy()) {
  requireCondition(
    plan && plan.schemaVersion === 1 && ROUTES.includes(plan.route),
    "compute-governor: invalid execution plan",
  );
  requireCondition(
    ["codex", "claude"].includes(plan.provider),
    "compute-governor: invalid plan provider",
  );
  requireCondition(
    planIdentityValid(plan, policy),
    "compute-governor: plan model/effort violates policy",
  );
  requireCondition(
    ROUTES.includes(plan.safetyFloor) &&
      rank(plan.route) >= rank(plan.safetyFloor),
    "compute-governor: plan route is below its safety floor",
  );
  requireCondition(
    planContractValid(plan, policy),
    "compute-governor: invalid execution plan contract",
  );
  requireCondition(
    plan.executionBinding === undefined ||
      executionBindingValid(plan.executionBinding, policy),
    "compute-governor: execution binding schema mismatch",
  );
  const expected = {
    ...(plan.executionBinding
      ? resolveLaunch(plan.facts, policy)
      : resolve(plan.facts, policy)),
    ...(plan.executionBinding
      ? { executionBinding: plan.executionBinding }
      : {}),
  };
  requireCondition(
    JSON.stringify(canonicalJson(plan)) ===
      JSON.stringify(canonicalJson(expected)),
    "compute-governor: execution plan is not bound to its facts",
  );
  return plan;
}

function validateExecutionPlan(
  plan,
  promptFile,
  targetDir,
  policy = loadPolicy(),
) {
  validatePlan(plan, policy);
  requireCondition(
    plan.executionBinding &&
      JSON.stringify(canonicalJson(plan.executionBinding)) ===
        JSON.stringify(
          canonicalJson(executionBinding(promptFile, targetDir, policy)),
        ),
    "compute-governor: execution plan is not bound to this prompt and target",
  );
  const expected = resolveExecution(plan.facts, promptFile, targetDir, policy);
  requireCondition(
    JSON.stringify(canonicalJson(plan)) ===
      JSON.stringify(canonicalJson(expected)),
    "compute-governor: protected execution facts do not match task evidence",
  );
  return plan;
}

function runRecordIdentityValid(record) {
  const identity = ["provider", "model", "effort"];
  return (
    identity.every((key) => record.requested[key] === record.plan[key]) &&
    identity.every((key) => record.effective[key] === record.plan[key])
  );
}

function timingValid(record) {
  return (
    Number.isInteger(record.attempts) &&
    record.attempts > 0 &&
    Number.isInteger(record.timing.startedAtEpochMs) &&
    Number.isInteger(record.timing.finishedAtEpochMs) &&
    record.timing.finishedAtEpochMs >= record.timing.startedAtEpochMs
  );
}

function outcomeValid(outcome) {
  const statuses = ["passed", "failed", "timeout", "unavailable", "exhausted"];
  if (!Number.isInteger(outcome.exitCode) || !statuses.includes(outcome.status))
    return false;
  if (outcome.status === "passed") {
    return outcome.exitCode === 0 && outcome.providerFailureCategory === null;
  }
  return (
    outcome.exitCode !== 0 &&
    typeof outcome.providerFailureCategory === "string" &&
    outcome.providerFailureCategory.length > 0
  );
}

function usageValid(usage) {
  return usage === null;
}

function validateRunRecord(record) {
  requireCondition(
    record &&
      record.schemaVersion === 1 &&
      record.plan &&
      record.outcome &&
      record.requested &&
      record.effective &&
      record.timing,
    "compute-governor: invalid run record",
  );
  assertNoSensitiveRecordFields(record);
  assertExactKeys(
    record,
    [
      "schemaVersion",
      "plan",
      "requested",
      "effective",
      "attempts",
      "timing",
      "outcome",
      "usage",
    ],
    "run record",
  );
  assertExactKeys(
    record.requested,
    ["provider", "model", "effort"],
    "requested identity",
  );
  assertExactKeys(
    record.effective,
    ["provider", "model", "effort"],
    "effective identity",
  );
  assertExactKeys(
    record.timing,
    ["startedAtEpochMs", "finishedAtEpochMs"],
    "timing",
  );
  assertExactKeys(
    record.outcome,
    ["status", "exitCode", "providerFailureCategory"],
    "outcome",
  );
  validatePlan(record.plan);
  requireCondition(
    runRecordIdentityValid(record) &&
      timingValid(record) &&
      outcomeValid(record.outcome),
    "compute-governor: invalid run record contract",
  );
  if (!usageValid(record.usage)) {
    throw new Error(
      "compute-governor: usage must remain null until a redacted schema is defined",
    );
  }
  return record;
}

function assertExactKeys(value, allowed, label) {
  const expected = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = allowed.filter((key) => !(key in value));
  requireCondition(
    unknown.length === 0 && missing.length === 0,
    `compute-governor: ${label} schema mismatch`,
  );
}

function assertNoSensitiveRecordFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_RECORD_KEYS.has(key)) {
      throw new Error(`compute-governor: forbidden run-record field '${key}'`);
    }
    assertNoSensitiveRecordFields(child);
  }
}

function calibrationRunValid(run) {
  return Boolean(
    run &&
    typeof run.accepted === "boolean" &&
    typeof run.gatesPassed === "boolean" &&
    Number.isInteger(run.attempts) &&
    run.attempts > 0 &&
    Number.isFinite(run.elapsedMs) &&
    run.elapsedMs >= 0,
  );
}

function calibrationThresholdValid(value) {
  return (
    value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

function calibrationDecision(report) {
  if (
    !report ||
    !Array.isArray(report.baseline) ||
    !Array.isArray(report.candidate) ||
    report.baseline.length === 0 ||
    report.baseline.length !== report.candidate.length
  ) {
    throw new Error(
      "compute-governor: calibration requires equal non-empty baseline and candidate arrays",
    );
  }
  if (
    !report.baseline.every(calibrationRunValid) ||
    !report.candidate.every(calibrationRunValid) ||
    !calibrationThresholdValid(report.maxAcceptanceRateDrop)
  ) {
    throw new Error("compute-governor: calibration run evidence is incomplete");
  }
  const allowedDrop = Number.isFinite(report.maxAcceptanceRateDrop)
    ? report.maxAcceptanceRateDrop
    : 0.05;
  const metrics = (runs) => ({
    acceptanceRate:
      runs.filter((run) => run.accepted === true && run.gatesPassed === true)
        .length / runs.length,
    averageAttempts:
      runs.reduce(
        (sum, run) =>
          sum + (Number.isFinite(run.attempts) ? run.attempts : Infinity),
        0,
      ) / runs.length,
    averageElapsedMs:
      runs.reduce((sum, run) => sum + run.elapsedMs, 0) / runs.length,
  });
  const baseline = metrics(report.baseline);
  const candidate = metrics(report.candidate);
  const accepted =
    candidate.acceptanceRate >= baseline.acceptanceRate - allowedDrop &&
    candidate.averageAttempts <= baseline.averageAttempts;
  return {
    schemaVersion: 1,
    status: accepted ? "eligible-for-default" : "candidate-only",
    threshold: {
      maxAcceptanceRateDrop: allowedDrop,
      maxAverageAttempts: baseline.averageAttempts,
    },
    baseline,
    candidate,
    reasons: accepted
      ? ["candidate meets acceptance and retry thresholds"]
      : ["candidate does not meet acceptance or retry threshold"],
  };
}

function readJson(file) {
  return parseJson(
    fs.readFileSync(file === "-" ? 0 : file, "utf8"),
    file === "-" ? "stdin" : file,
  );
}

function main(argv) {
  const [command, file, promptFile, targetDir] = argv;
  if (
    !file ||
    ![
      "resolve",
      "resolve-execution",
      "explain",
      "validate-plan",
      "validate-execution-plan",
      "validate-run-record",
      "calibrate",
    ].includes(command)
  ) {
    throw new Error(
      "usage: compute-governor.js resolve|explain|validate-plan|validate-run-record|calibrate <json-file>; resolve-execution|validate-execution-plan <json-file> <prompt-file> <target-dir>",
    );
  }
  if (
    ["resolve-execution", "validate-execution-plan"].includes(command) &&
    (!promptFile || !targetDir)
  ) {
    throw new Error(`${command} requires a prompt file and target directory`);
  }
  const input = readJson(file);
  const result =
    command === "resolve-execution"
      ? resolveExecution(input, promptFile, targetDir)
      : command === "validate-execution-plan"
        ? validateExecutionPlan(input, promptFile, targetDir)
        : command === "resolve" || command === "explain"
          ? resolve(input)
          : command === "validate-plan"
            ? validatePlan(input)
            : command === "validate-run-record"
              ? validateRunRecord(input)
              : calibrationDecision(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  ROUTES,
  loadPolicy,
  resolve,
  resolveExecution,
  validatePlan,
  validateExecutionPlan,
  validateRunRecord,
  calibrationDecision,
};
