#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_TELEMETRY_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7]);
const FINISHED_VERDICTS = new Set(["authorized", "passed"]);
const FULL_SELECTION_MODES = new Set(["audit", "complete"]);

function rate(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values, percentage) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil((percentage / 100) * sorted.length) - 1];
}

function filesAt(input) {
  const resolved = path.resolve(input);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error(`${input} must not be a symlink`);
  if (stat.isFile()) return [resolved];
  if (!stat.isDirectory())
    throw new Error(`${input} is not a file or directory`);
  return fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(resolved, entry.name))
    .sort();
}

function loadTelemetry(inputs) {
  const records = [];
  let malformedLines = 0;
  let unsupportedRecords = 0;
  for (const file of inputs.flatMap(filesAt)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (
        !SUPPORTED_TELEMETRY_VERSIONS.has(record.telemetrySchemaVersion) ||
        typeof record.invocationId !== "string" ||
        typeof record.recordedAt !== "string"
      ) {
        unsupportedRecords += 1;
        continue;
      }
      records.push(record);
    }
  }
  const byInvocation = new Map();
  for (const record of records) {
    const prior = byInvocation.get(record.invocationId);
    if (!prior || record.recordedAt > prior.recordedAt) {
      byInvocation.set(record.invocationId, record);
    }
  }
  return {
    records: [...byInvocation.values()],
    rawRecordCount: records.length,
    duplicateRecordCount: records.length - byInvocation.size,
    malformedLines,
    unsupportedRecords,
  };
}

function readEvidence(file, validator, label) {
  if (!file)
    return { value: null, complete: false, reason: `${label}-not-provided` };
  try {
    const value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    if (!validator(value)) throw new Error("unsupported schema or fields");
    return { value, complete: true, reason: null };
  } catch (error) {
    return {
      value: null,
      complete: false,
      reason: `${label}-invalid: ${error.message}`,
    };
  }
}

function validCiSnapshot(value) {
  return (
    value?.schemaVersion === 1 &&
    Number.isFinite(value.usedMinutes) &&
    Number.isFinite(value.includedMinutes) &&
    typeof value.fetchedAt === "string"
  );
}

function validDispositions(value) {
  return (
    value?.schemaVersion === 1 &&
    typeof value.source === "string" &&
    value.source.trim() !== "" &&
    typeof value.asOf === "string" &&
    Number.isFinite(Date.parse(value.asOf)) &&
    ["confirmed", "refuted", "escaped"].every(
      (field) => Number.isInteger(value[field]) && value[field] >= 0,
    )
  );
}

function duplicateFullSuite(records) {
  const missing = records.filter(
    (record) => record.testSelectionMode == null,
  ).length;
  const full = records.filter((record) =>
    FULL_SELECTION_MODES.has(record.testSelectionMode),
  );
  const heads = new Set(
    full.map((record) => `${record.repoKey}:${record.head}`),
  );
  const duplicateExecutions = full.length - heads.size;
  return {
    fullSuiteExecutions: full.length,
    duplicateExecutions,
    rate: rate(duplicateExecutions, full.length),
    complete: missing === 0,
    missingSelectionRecords: missing,
  };
}

function buildReport(loaded, { ciEvidence, dispositionEvidence, generatedAt }) {
  const preflightRecords = loaded.records.filter(
    (record) => record.preflight === true,
  ).length;
  const records = loaded.records.filter((record) => record.preflight !== true);
  const durations = records
    .map((record) => record.durationSeconds)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const fallbackSamples = records.filter(
    (record) => typeof record.fallbackUsed === "boolean",
  );
  const fallbacks = fallbackSamples.filter(
    (record) => record.fallbackUsed === true,
  ).length;
  const convergenceSamples = records.filter(
    (record) => typeof record.verdict === "string",
  );
  const converged = convergenceSamples.filter((record) =>
    FINISHED_VERDICTS.has(record.verdict),
  ).length;
  const fullSuite = duplicateFullSuite(records);
  const telemetryComplete =
    loaded.malformedLines === 0 && loaded.unsupportedRecords === 0;
  return {
    schemaVersion: 1,
    generatedAt,
    population: {
      campaigns: records.length,
      rawRecords: loaded.rawRecordCount,
      duplicateRecordsIgnored: loaded.duplicateRecordCount,
      preflightRecordsIgnored: preflightRecords,
      malformedLines: loaded.malformedLines,
      unsupportedRecords: loaded.unsupportedRecords,
    },
    metrics: {
      durationSeconds: {
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        samples: durations.length,
        complete: durations.length === records.length,
      },
      fallbackRate: {
        value: rate(fallbacks, fallbackSamples.length),
        fallbacks,
        samples: fallbackSamples.length,
        complete: fallbackSamples.length === records.length,
      },
      convergenceRate: {
        value: rate(converged, convergenceSamples.length),
        converged,
        samples: convergenceSamples.length,
        complete: convergenceSamples.length === records.length,
      },
      duplicateFullSuiteRate: fullSuite,
      ciMinutes: ciEvidence.complete
        ? {
            used: ciEvidence.value.usedMinutes,
            included: ciEvidence.value.includedMinutes,
            fetchedAt: ciEvidence.value.fetchedAt,
          }
        : null,
      findingDispositions: dispositionEvidence.complete
        ? {
            confirmed: dispositionEvidence.value.confirmed,
            refuted: dispositionEvidence.value.refuted,
            escaped: dispositionEvidence.value.escaped,
            source: dispositionEvidence.value.source,
            asOf: dispositionEvidence.value.asOf,
          }
        : null,
    },
    completeness: {
      telemetry: telemetryComplete,
      testSelection: fullSuite.complete,
      ciMinutes: ciEvidence.complete,
      findingDispositions: dispositionEvidence.complete,
      reasons: [
        !telemetryComplete ? "telemetry-malformed-or-unsupported" : null,
        durations.length !== records.length
          ? "historical-records-missing-duration"
          : null,
        fallbackSamples.length !== records.length
          ? "historical-records-missing-fallback-attribution"
          : null,
        convergenceSamples.length !== records.length
          ? "historical-records-missing-verdict"
          : null,
        !fullSuite.complete
          ? "historical-records-missing-test-selection"
          : null,
        ciEvidence.reason,
        dispositionEvidence.reason,
      ].filter(Boolean),
    },
  };
}

function parseArgs(argv) {
  const result = { inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") result.inputs.push(argv[++index]);
    else if (value === "--ci-snapshot") result.ciSnapshot = argv[++index];
    else if (value === "--dispositions") result.dispositions = argv[++index];
    else throw new Error(`unknown or incomplete argument: ${value}`);
  }
  if (result.inputs.length === 0)
    throw new Error("at least one --input is required");
  return result;
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const report = buildReport(loadTelemetry(options.inputs), {
      ciEvidence: readEvidence(
        options.ciSnapshot,
        validCiSnapshot,
        "ci-snapshot",
      ),
      dispositionEvidence: readEvidence(
        options.dispositions,
        validDispositions,
        "finding-dispositions",
      ),
      generatedAt: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.completeness.telemetry ? 0 : 1;
  } catch (error) {
    process.stderr.write(`quality-telemetry-report: ${error.message}\n`);
    return 2;
  }
}

module.exports = {
  buildReport,
  duplicateFullSuite,
  loadTelemetry,
  main,
  percentile,
  readEvidence,
  validCiSnapshot,
  validDispositions,
};

if (require.main === module) process.exitCode = main();
