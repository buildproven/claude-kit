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

function loadPolicy(file = policyPath()) {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  assertPolicySchema(policy);
  ROUTES.forEach((route) => assertRoutePolicy(policy, route));
  return policy;
}

function assertPolicySchema(policy) {
  if (
    policy.schemaVersion !== 1 ||
    typeof policy.policyVersion !== "string" ||
    policy.policyVersion.length === 0 ||
    !policy.routes ||
    !Array.isArray(policy.protectedSurfaces)
  ) {
    throw new Error("compute-governor: unsupported policy schema version");
  }
}

function assertRoutePolicy(policy, route) {
  const routePolicy = policy.routes[route];
  const validProviders =
    routePolicy?.providers?.codex && routePolicy?.providers?.claude;
  const validWallClock =
    Number.isInteger(routePolicy?.caps?.maxWallSeconds) &&
    routePolicy.caps.maxWallSeconds > 0;
  if (
    !validProviders ||
    !validWallClock ||
    routePolicy?.caps?.maxWorkers !== 1
  ) {
    throw new Error(`compute-governor: policy missing route '${route}'`);
  }
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

function assertFacts(facts) {
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
  assertFacts(facts);
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

function validatePlan(plan, policy = loadPolicy()) {
  if (!plan || plan.schemaVersion !== 1 || !ROUTES.includes(plan.route)) {
    throw new Error("compute-governor: invalid execution plan");
  }
  if (!["codex", "claude"].includes(plan.provider)) {
    throw new Error("compute-governor: invalid plan provider");
  }
  assertPlanPolicyMapping(plan, policy);
  assertPlanSafetyFloor(plan);
  assertPlanContract(plan, policy);
  return plan;
}

function assertPlanPolicyMapping(plan, policy) {
  const mapping = policy.routes[plan.route].providers[plan.provider];
  if (
    plan.policyVersion !== policy.policyVersion ||
    plan.model !== mapping.model ||
    plan.effort !== mapping.effort
  ) {
    throw new Error("compute-governor: plan model/effort violates policy");
  }
}

function assertPlanSafetyFloor(plan) {
  if (
    !ROUTES.includes(plan.safetyFloor) ||
    rank(plan.route) < rank(plan.safetyFloor)
  ) {
    throw new Error("compute-governor: plan route is below its safety floor");
  }
}

function assertPlanContract(plan, policy) {
  const expectedPromotion = plan.route.startsWith("economy")
    ? "candidate-requires-calibration"
    : "not-applicable";
  const validReasons =
    Array.isArray(plan.reasons) &&
    plan.reasons.length > 0 &&
    plan.reasons.every(
      (reason) => typeof reason === "string" && reason.length > 0,
    );
  if (
    plan.contextClass !== "fresh-bounded" ||
    JSON.stringify(plan.caps) !==
      JSON.stringify(policy.routes[plan.route].caps) ||
    !validReasons ||
    plan.promotion !== expectedPromotion
  ) {
    throw new Error("compute-governor: invalid execution plan contract");
  }
}

function validateRunRecord(record) {
  if (
    !record ||
    record.schemaVersion !== 1 ||
    !record.plan ||
    !record.outcome ||
    !record.requested ||
    !record.effective ||
    !record.timing
  ) {
    throw new Error("compute-governor: invalid run record");
  }
  assertNoSensitiveRecordFields(record);
  validatePlan(record.plan);
  if (
    !validRecordIdentity(record) ||
    !validRecordTiming(record) ||
    !validRecordOutcome(record)
  ) {
    throw new Error("compute-governor: invalid run record contract");
  }
  if (record.usage !== null && typeof record.usage !== "object") {
    throw new Error("compute-governor: usage must be null or an object");
  }
  return record;
}

function validRecordIdentity(record) {
  const identity = ["provider", "model", "effort"];
  return (
    identity.every(
      (key) =>
        record.requested[key] === record.plan[key] &&
        record.effective[key] === record.plan[key],
    ) &&
    Number.isInteger(record.attempts) &&
    record.attempts >= 1
  );
}

function validRecordTiming(record) {
  const { startedAtEpochMs, finishedAtEpochMs } = record.timing;
  return (
    Number.isInteger(startedAtEpochMs) &&
    Number.isInteger(finishedAtEpochMs) &&
    finishedAtEpochMs >= startedAtEpochMs
  );
}

function validRecordOutcome(record) {
  const validStatus = [
    "passed",
    "failed",
    "timeout",
    "unavailable",
    "exhausted",
  ].includes(record.outcome.status);
  const validCategory =
    record.outcome.providerFailureCategory === null ||
    typeof record.outcome.providerFailureCategory === "string";
  return validStatus && validCategory;
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

function calibrationDecision(report) {
  assertCalibrationShape(report);
  const validRun = (run) =>
    run &&
    typeof run.accepted === "boolean" &&
    typeof run.gatesPassed === "boolean" &&
    Number.isInteger(run.attempts) &&
    run.attempts > 0 &&
    Number.isFinite(run.elapsedMs) &&
    run.elapsedMs >= 0;
  if (
    !report.baseline.every(validRun) ||
    !report.candidate.every(validRun) ||
    !validAcceptanceDrop(report.maxAcceptanceRateDrop)
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

function assertCalibrationShape(report) {
  const equalNonEmptyArrays =
    Array.isArray(report?.baseline) &&
    Array.isArray(report?.candidate) &&
    report.baseline.length > 0 &&
    report.baseline.length === report.candidate.length;
  if (!equalNonEmptyArrays)
    throw new Error(
      "compute-governor: calibration requires equal non-empty baseline and candidate arrays",
    );
}

function validAcceptanceDrop(value) {
  return (
    value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
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
