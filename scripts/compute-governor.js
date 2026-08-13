#!/usr/bin/env node
"use strict";

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
  return Boolean(
    routePolicy?.providers?.codex &&
    routePolicy?.providers?.claude &&
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
      Array.isArray(policy.protectedSurfaces),
    "compute-governor: unsupported policy schema version",
  );
  for (const route of ROUTES) {
    requireCondition(
      routePolicyValid(policy.routes[route]),
      `compute-governor: policy missing route '${route}'`,
    );
  }
  return policy;
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
  return changedFilesValid && failureStreakValid && operatorRouteValid;
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
  const expectedPromotion = plan.route.startsWith("economy")
    ? "candidate-requires-calibration"
    : "not-applicable";
  return (
    plan.contextClass === "fresh-bounded" &&
    JSON.stringify(plan.caps) === JSON.stringify(expectedCaps) &&
    Array.isArray(plan.reasons) &&
    plan.reasons.length > 0 &&
    plan.reasons.every(
      (reason) => typeof reason === "string" && reason.length > 0,
    ) &&
    plan.promotion === expectedPromotion
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
  return usage === null || (typeof usage === "object" && !Array.isArray(usage));
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
  validatePlan(record.plan);
  requireCondition(
    runRecordIdentityValid(record) &&
      timingValid(record) &&
      outcomeValid(record.outcome),
    "compute-governor: invalid run record contract",
  );
  if (!usageValid(record.usage)) {
    throw new Error("compute-governor: usage must be null or an object");
  }
  return record;
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
  const [command, file] = argv;
  if (
    !file ||
    ![
      "resolve",
      "explain",
      "validate-plan",
      "validate-run-record",
      "calibrate",
    ].includes(command)
  ) {
    throw new Error(
      "usage: compute-governor.js resolve|explain|validate-plan|validate-run-record|calibrate <json-file>",
    );
  }
  const input = readJson(file);
  const result =
    command === "resolve" || command === "explain"
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
  validatePlan,
  validateRunRecord,
  calibrationDecision,
};
