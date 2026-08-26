#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_TELEMETRY_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
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
        record === null ||
        typeof record !== "object" ||
        Array.isArray(record) ||
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
    value.usedMinutes >= 0 &&
    Number.isFinite(value.includedMinutes) &&
    value.includedMinutes > 0 &&
    typeof value.fetchedAt === "string" &&
    Number.isFinite(Date.parse(value.fetchedAt))
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

function populationClass(record) {
  if (record.preflight === true || record.recordClass === "preflight") {
    return "preflight";
  }
  if (
    record.recordClass === "fixture" ||
    (typeof record.githubRepository === "string" &&
      (record.githubRepository.startsWith("vitest/") ||
        record.githubRepository === "owner/repo"))
  ) {
    return "fixture";
  }
  if (
    typeof record.githubRepository !== "string" ||
    !record.githubRepository.trim()
  ) {
    return "unattributed";
  }
  return "production";
}

function metric(values, population) {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    samples: values.length,
    missing: population - values.length,
    complete: values.length === population,
  };
}

function automaticDispositions(records) {
  const rows = records.flatMap((record) =>
    Array.isArray(record.findingDispositions)
      ? record.findingDispositions.map((finding) => ({
          ...finding,
          invocationId: record.invocationId,
        }))
      : [],
  );
  const missing = records.reduce(
    (sum, record) =>
      sum +
      (Number.isInteger(record.findingDispositionMissingCount)
        ? record.findingDispositionMissingCount
        : Number.isInteger(record.leadCount)
          ? record.leadCount
          : 0),
    0,
  );
  const count = (disposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  const resolutionMissing = rows.filter(
    (row) => typeof row.resolution !== "string" || !row.resolution,
  ).length;
  const resolutionCount = (resolution) =>
    rows.filter((row) => row.resolution === resolution).length;
  return {
    blocking: count("BLOCKING"),
    warning: count("WARNING"),
    suppressed: count("SUPPRESSED"),
    samples: rows.length,
    missing,
    resolutions: {
      fixed: resolutionCount("fixed"),
      confirmedUnresolved: resolutionCount("confirmed-unresolved"),
      confirmedNonblocking: resolutionCount("confirmed-nonblocking"),
      acceptedRisk: resolutionCount("accepted-risk"),
      refuted: resolutionCount("refuted"),
      duplicate: resolutionCount("duplicate"),
      nonActionable: resolutionCount("non-actionable"),
      missing: resolutionMissing,
    },
    complete: missing === 0 && resolutionMissing === 0,
    source: "signed-judge-artifacts",
  };
}

function includedPopulation(item, includeFixtures) {
  return (
    item.class === "production" || (includeFixtures && item.class === "fixture")
  );
}

function nonnegativeFinite(value) {
  return Number.isFinite(value) && value >= 0;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function ciMinutesMetric(ciEvidence) {
  if (!ciEvidence.complete) return null;
  return {
    used: ciEvidence.value.usedMinutes,
    included: ciEvidence.value.includedMinutes,
    fetchedAt: ciEvidence.value.fetchedAt,
  };
}

function ignoredFixtureCount(includeFixtures, count) {
  return includeFixtures ? 0 : count;
}

function buildReport(
  loaded,
  { ciEvidence, dispositionEvidence, generatedAt, includeFixtures = false },
) {
  const classified = loaded.records.map((record) => ({
    record,
    class: populationClass(record),
  }));
  const countClass = (name) =>
    classified.filter((item) => item.class === name).length;
  const records = classified
    .filter((item) => includedPopulation(item, includeFixtures))
    .map((item) => item.record);
  const durations = records
    .map((record) => record.durationSeconds)
    .filter(nonnegativeFinite);
  const activeDurations = records
    .map((record) => record.activeDurationSeconds)
    .filter(nonnegativeFinite);
  const exactTokens = records
    .map((record) => record.reviewTokens)
    .filter(nonnegativeInteger);
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
  const dispositions = automaticDispositions(records);
  const telemetryComplete =
    records.length > 0 &&
    loaded.malformedLines === 0 &&
    loaded.unsupportedRecords === 0;
  return {
    schemaVersion: 1,
    generatedAt,
    population: {
      campaigns: records.length,
      productionCampaigns: countClass("production"),
      rawRecords: loaded.rawRecordCount,
      duplicateRecordsIgnored: loaded.duplicateRecordCount,
      preflightRecordsIgnored: countClass("preflight"),
      fixtureRecordsIgnored: ignoredFixtureCount(
        includeFixtures,
        countClass("fixture"),
      ),
      unattributedRecordsIgnored: countClass("unattributed"),
      fixturesIncluded: includeFixtures,
      malformedLines: loaded.malformedLines,
      unsupportedRecords: loaded.unsupportedRecords,
    },
    metrics: {
      durationSeconds: metric(durations, records.length),
      activeDurationSeconds: metric(activeDurations, records.length),
      exactReviewTokens: {
        ...metric(exactTokens, records.length),
        total: exactTokens.reduce((sum, value) => sum + value, 0),
        source: "provider-cli",
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
      mergedCampaigns: records.filter(
        (record) => record.terminalState === "merged",
      ).length,
      ciMinutes: ciMinutesMetric(ciEvidence),
      findingDispositions: dispositions,
      legacyFindingDispositions: dispositionEvidence.complete
        ? dispositionEvidence.value
        : null,
    },
    completeness: {
      telemetry: telemetryComplete,
      testSelection: fullSuite.complete,
      ciMinutes: ciEvidence.complete,
      findingDispositions: dispositions.complete,
      reasons: [
        records.length === 0 ? "no-telemetry-records" : null,
        loaded.malformedLines > 0 || loaded.unsupportedRecords > 0
          ? "telemetry-malformed-or-unsupported"
          : null,
        durations.length !== records.length
          ? "historical-records-missing-duration"
          : null,
        fallbackSamples.length !== records.length
          ? "historical-records-missing-fallback-attribution"
          : null,
        convergenceSamples.length !== records.length
          ? "historical-records-missing-verdict"
          : null,
        activeDurations.length !== records.length
          ? "historical-records-missing-active-duration"
          : null,
        exactTokens.length !== records.length
          ? "provider-token-usage-missing"
          : null,
        !fullSuite.complete
          ? "historical-records-missing-test-selection"
          : null,
        ciEvidence.reason,
        dispositions.complete ? null : "finding-dispositions-missing",
      ].filter(Boolean),
    },
  };
}

function parseArgs(argv) {
  const result = { inputs: [], includeFixtures: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") result.inputs.push(argv[++index]);
    else if (value === "--ci-snapshot") result.ciSnapshot = argv[++index];
    else if (value === "--dispositions") result.dispositions = argv[++index];
    else if (value === "--include-fixtures") result.includeFixtures = true;
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
      includeFixtures: options.includeFixtures,
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
  populationClass,
  readEvidence,
  validCiSnapshot,
  validDispositions,
};

if (require.main === module) process.exitCode = main();
