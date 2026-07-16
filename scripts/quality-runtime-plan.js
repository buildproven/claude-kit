#!/usr/bin/env node
"use strict";

const { score, scoreToKnobs, DEFAULTS } = require("./risk-score");

const WORKLOAD_BANDS = [
  {
    name: "micro",
    maxUnits: 100,
    campaignSeconds: 300,
    reviewSeconds: 75,
    verificationSeconds: 60,
    gateSeconds: 120,
  },
  {
    name: "small",
    maxUnits: 400,
    campaignSeconds: 420,
    reviewSeconds: 120,
    verificationSeconds: 90,
    gateSeconds: 180,
  },
  {
    name: "medium",
    maxUnits: 1500,
    campaignSeconds: 600,
    reviewSeconds: 210,
    verificationSeconds: 120,
    gateSeconds: 240,
  },
  {
    name: "large",
    maxUnits: 5000,
    campaignSeconds: 780,
    reviewSeconds: 330,
    verificationSeconds: 180,
    gateSeconds: 300,
  },
  {
    name: "huge",
    maxUnits: Number.POSITIVE_INFINITY,
    campaignSeconds: 900,
    reviewSeconds: 480,
    verificationSeconds: 240,
    gateSeconds: 360,
  },
];

const RISK_FLOORS = {
  low: { campaignSeconds: 300, reviewSeconds: 75 },
  medium: { campaignSeconds: 420, reviewSeconds: 120 },
  high: { campaignSeconds: 540, reviewSeconds: 180 },
  critical: { campaignSeconds: 600, reviewSeconds: 240 },
};

function riskTier(value) {
  if (value >= 75) return "critical";
  if (value >= 50) return "high";
  if (value >= 20) return "medium";
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
    WORKLOAD_BANDS.at(-1);
  return { ...band, units };
}

function planRuntime({ riskScore, diffStats, minimumRisk = 0, knobs = null }) {
  const normalizedRisk = Math.max(
    0,
    Math.min(100, Math.max(Number(riskScore) || 0, Number(minimumRisk) || 0)),
  );
  const tier = riskTier(normalizedRisk);
  const band = workloadBand(diffStats);
  const floor = RISK_FLOORS[tier];
  const resolvedKnobs =
    knobs && normalizedRisk === Number(riskScore)
      ? knobs
      : scoreToKnobs(normalizedRisk, DEFAULTS);

  return {
    riskScore: normalizedRisk,
    tier,
    workload: band.name,
    workloadUnits: band.units,
    diffStats: {
      files: Math.max(0, Number(diffStats?.files) || 0),
      lines: Math.max(0, Number(diffStats?.lines) || 0),
    },
    campaignSeconds: Math.max(band.campaignSeconds, floor.campaignSeconds),
    reviewSeconds: Math.max(band.reviewSeconds, floor.reviewSeconds),
    verificationSeconds: band.verificationSeconds,
    gateSeconds: band.gateSeconds,
    agents: resolvedKnobs.agents,
    reviewDepth: resolvedKnobs.codex === "skip" ? "low" : resolvedKnobs.codex,
    reviewPasses: resolvedKnobs.codexRounds || 1,
    maxReviewRounds: 2,
    maxFixCommits: 1,
  };
}

function parseArgs(argv) {
  const args = { base: null, minimumRisk: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--base" && argv[index + 1]) {
      args.base = argv[++index];
    } else if (argv[index] === "--minimum-risk" && argv[index + 1]) {
      args.minimumRisk = Number(argv[++index]);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scored = score({ base: args.base });
  const result = {
    ...planRuntime({
      riskScore: scored.riskScore,
      diffStats: scored.diffStats,
      minimumRisk: args.minimumRisk,
      knobs: scored.knobs,
    }),
    changeNature: scored.changeNature,
    reasons: scored.reasons,
    base: scored.base,
  };
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
