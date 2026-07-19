#!/usr/bin/env node
"use strict";

/**
 * Convert change risk and workload into one bounded quality-run plan.
 *
 * Risk controls depth. Workload controls time. Keeping those dimensions
 * separate prevents a one-line security edit from receiving a huge-change
 * clock, while still giving a broad low-risk diff enough time to be read.
 */

const {
  score,
  scoreToKnobs,
  DEFAULTS,
  CRITICAL_RISK_SCORE,
} = require("./risk-score");

const WORKLOAD_BANDS = [
  {
    name: "micro",
    maxUnits: 100,
    campaignSeconds: 300,
    reviewSeconds: 75,
    verificationSeconds: 60,
    checkSeconds: 120,
    reviewReserveSeconds: 90,
    checkReserveSeconds: 180,
  },
  {
    name: "small",
    maxUnits: 400,
    campaignSeconds: 420,
    reviewSeconds: 120,
    verificationSeconds: 90,
    checkSeconds: 180,
    reviewReserveSeconds: 120,
    checkReserveSeconds: 240,
  },
  {
    name: "medium",
    maxUnits: 1500,
    campaignSeconds: 600,
    reviewSeconds: 210,
    verificationSeconds: 120,
    checkSeconds: 240,
    reviewReserveSeconds: 150,
    checkReserveSeconds: 390,
  },
  {
    name: "large",
    maxUnits: 5000,
    campaignSeconds: 780,
    reviewSeconds: 330,
    verificationSeconds: 180,
    checkSeconds: 300,
    reviewReserveSeconds: 210,
    checkReserveSeconds: 540,
  },
  {
    name: "huge",
    maxUnits: Number.POSITIVE_INFINITY,
    campaignSeconds: 900,
    reviewSeconds: 480,
    verificationSeconds: 240,
    checkSeconds: 360,
    reviewReserveSeconds: 270,
    checkReserveSeconds: 720,
  },
];

const RISK_FLOORS = {
  low: { campaignSeconds: 300, reviewSeconds: 75 },
  medium: { campaignSeconds: 420, reviewSeconds: 120 },
  high: { campaignSeconds: 540, reviewSeconds: 180 },
  critical: { campaignSeconds: 600, reviewSeconds: 240 },
};

function riskTier(riskScore) {
  if (riskScore >= CRITICAL_RISK_SCORE) return "critical";
  if (riskScore >= 50) return "high";
  if (riskScore >= 20) return "medium";
  return "low";
}

function workloadUnits(diffStats = {}) {
  const files = Math.max(0, Number(diffStats.files) || 0);
  const lines = Math.max(0, Number(diffStats.lines) || 0);
  return lines + files * 25;
}

function workloadBand(diffStats) {
  const units = workloadUnits(diffStats);
  const band =
    WORKLOAD_BANDS.find((candidate) => units <= candidate.maxUnits) ||
    WORKLOAD_BANDS[WORKLOAD_BANDS.length - 1];
  return { ...band, units };
}

function normalizedRiskScore(riskScore, minimumRisk) {
  return Math.max(
    0,
    Math.min(100, Math.max(Number(riskScore) || 0, Number(minimumRisk) || 0)),
  );
}

function reviewKnobs(riskScore, normalizedRisk, knobs) {
  if (knobs && normalizedRisk === Number(riskScore)) return knobs;
  return scoreToKnobs(normalizedRisk, DEFAULTS);
}

function plannedDepth(mode, knobs) {
  if (mode === "verification") return "high";
  return knobs.codex === "skip" ? "low" : knobs.codex;
}

function planRuntime({
  riskScore,
  diffStats,
  mode = "discovery",
  knobs = null,
  minimumRisk = 0,
}) {
  if (!["discovery", "verification"].includes(mode)) {
    throw new Error(`invalid review mode: ${mode}`);
  }
  const normalizedRisk = normalizedRiskScore(riskScore, minimumRisk);
  const tier = riskTier(normalizedRisk);
  const band = workloadBand(diffStats);
  const riskFloor = RISK_FLOORS[tier];
  const resolvedKnobs = reviewKnobs(riskScore, normalizedRisk, knobs);
  const discoverySeconds = Math.max(
    band.reviewSeconds,
    riskFloor.reviewSeconds,
  );
  const reviewSeconds =
    mode === "verification" ? band.verificationSeconds : discoverySeconds;

  return {
    riskScore: normalizedRisk,
    tier,
    workload: band.name,
    workloadUnits: band.units,
    diffStats: {
      files: Math.max(0, Number(diffStats?.files) || 0),
      lines: Math.max(0, Number(diffStats?.lines) || 0),
    },
    mode,
    campaignSeconds: Math.max(band.campaignSeconds, riskFloor.campaignSeconds),
    reviewSeconds,
    verificationSeconds: band.verificationSeconds,
    checkSeconds: band.checkSeconds,
    reviewReserveSeconds: band.reviewReserveSeconds,
    checkReserveSeconds: band.checkReserveSeconds,
    agents: resolvedKnobs.agents,
    reviewDepth: plannedDepth(mode, resolvedKnobs),
    reviewPasses: mode === "verification" ? 1 : resolvedKnobs.codexRounds || 1,
  };
}

function parseArgs(argv) {
  const args = {
    base: null,
    mode: "discovery",
    minimumRisk: 0,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base" && argv[index + 1]) {
      args.base = argv[++index];
    } else if (argv[index] === "--mode" && argv[index + 1]) {
      args.mode = argv[++index];
    } else if (argv[index] === "--minimum-risk" && argv[index + 1]) {
      args.minimumRisk = Number(argv[++index]);
    } else if (argv[index] === "--json") {
      args.json = true;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scored = score({ base: args.base });
  const plan = planRuntime({
    riskScore: scored.riskScore,
    diffStats: scored.diffStats,
    mode: args.mode,
    knobs: scored.knobs,
    minimumRisk: args.minimumRisk,
  });
  const result = {
    ...plan,
    changeNature: scored.changeNature,
    reasons: scored.reasons,
    base: scored.base,
  };
  // Always emit the plan as JSON on stdout. The sole production consumer,
  // quality-risk-resolve.sh, captures this stdout and feeds every field into
  // `quality-invocation.js risk`. Gating output on GITHUB_OUTPUT (as a prior
  // revision did) silently produced empty stdout under GitHub Actions — where
  // GITHUB_OUTPUT is always set — so the resolver read an empty tier and threw
  // `invalid resolved tier ''`, failing risk resolution in CI only. This script
  // is a CLI invoked by a shell script, not a GitHub Actions step that writes
  // to $GITHUB_OUTPUT, so there is nothing to gate on.
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  planRuntime,
  riskTier,
  workloadBand,
  workloadUnits,
  WORKLOAD_BANDS,
  RISK_FLOORS,
};
