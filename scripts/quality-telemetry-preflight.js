#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  TELEMETRY_SCHEMA_VERSION,
  validateRecord,
} = require("./quality-telemetry");

function preflightRecord(reviewArm, recordedAt) {
  const record = {
    telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
    invocationId: `preflight-${reviewArm}-${crypto.randomUUID()}`,
    recordedAt,
    repoKey: "quality-telemetry-preflight",
    githubRepository: null,
    pr: null,
    branch: null,
    baseSha: null,
    head: null,
    taskType: null,
    riskTier: null,
    riskScore: null,
    requestedLevel: null,
    reviewArm,
    reviewProvider: reviewArm === "native" ? "codex" : "claude",
    reviewEffort: "high",
    reviewTokens: null,
    durationSeconds: null,
    reviewRounds: 0,
    agentsRun: 0,
    blockingCount: null,
    mergeRequested: false,
    verdict: null,
    coveredFiles: [],
    preflight: true,
  };
  if (!validateRecord(record)) {
    throw new Error(`invalid ${reviewArm} telemetry preflight record`);
  }
  return record;
}

function writePreflight(output, recordedAt = new Date().toISOString()) {
  const records = ["bespoke", "native"].map((reviewArm) =>
    preflightRecord(reviewArm, recordedAt),
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${records.map(JSON.stringify).join("\n")}\n`);
  return records;
}

function main() {
  const [, , flag, output] = process.argv;
  if (flag !== "--output" || !output) {
    process.stderr.write(
      "usage: quality-telemetry-preflight.js --output <jsonl-path>\n",
    );
    process.exit(2);
  }
  const records = writePreflight(path.resolve(output));
  process.stdout.write(
    `[quality] telemetry preflight wrote ${records.length} comparison records to ${path.resolve(output)}\n`,
  );
}

module.exports = { preflightRecord, writePreflight };

if (require.main === module) main();
