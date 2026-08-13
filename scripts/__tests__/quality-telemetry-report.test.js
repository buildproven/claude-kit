const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const {
  buildReport,
  loadTelemetry,
  percentile,
  readEvidence,
  validCiSnapshot,
  validDispositions,
} = require("../quality-telemetry-report");

function record(overrides = {}) {
  return {
    telemetrySchemaVersion: 7,
    invocationId: randomUUID(),
    recordedAt: "2026-08-13T00:00:00.000Z",
    repoKey: "sample",
    head: "abc",
    durationSeconds: 20,
    fallbackUsed: false,
    verdict: "passed",
    testSelectionMode: "focused",
    ...overrides,
  };
}

function evidence(value) {
  return { value, complete: true, reason: null };
}

describe("quality telemetry report", () => {
  it("uses deterministic nearest-rank percentiles", () => {
    expect(percentile([100, 10, 20], 50)).toBe(20);
    expect(percentile([100, 10, 20], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });

  it("labels a zero-campaign population incomplete", () => {
    const report = buildReport(
      {
        records: [],
        rawRecordCount: 0,
        duplicateRecordCount: 0,
        malformedLines: 0,
        unsupportedRecords: 0,
      },
      {
        ciEvidence: {
          value: null,
          complete: false,
          reason: "ci-snapshot-not-provided",
        },
        dispositionEvidence: {
          value: null,
          complete: false,
          reason: "finding-dispositions-not-provided",
        },
        generatedAt: "2026-08-13T01:00:00Z",
      },
    );
    expect(report.completeness.telemetry).toBe(false);
    expect(report.completeness.reasons).toContain("no-telemetry-records");
  });

  it("reports duration, fallback, convergence, duplicate suites, CI, and findings", () => {
    const records = [
      record({
        invocationId: "one",
        durationSeconds: 10,
        head: "same",
        testSelectionMode: "audit",
      }),
      record({
        invocationId: "two",
        durationSeconds: 20,
        head: "same",
        testSelectionMode: "audit",
        fallbackUsed: true,
      }),
      record({
        invocationId: "three",
        durationSeconds: 100,
        head: "other",
        verdict: "blocked",
      }),
    ];
    const report = buildReport(
      {
        records,
        rawRecordCount: 3,
        duplicateRecordCount: 0,
        malformedLines: 0,
        unsupportedRecords: 0,
      },
      {
        ciEvidence: evidence({
          usedMinutes: 70,
          includedMinutes: 3000,
          fetchedAt: "2026-08-13T00:00:00Z",
        }),
        dispositionEvidence: evidence({
          confirmed: 3,
          refuted: 2,
          escaped: 1,
          source: "signed-ledger.jsonl",
          asOf: "2026-08-13T00:00:00Z",
        }),
        generatedAt: "2026-08-13T01:00:00Z",
      },
    );
    expect(report.metrics).toMatchObject({
      durationSeconds: { p50: 20, p95: 100, samples: 3, complete: true },
      fallbackRate: { value: 1 / 3, fallbacks: 1, samples: 3, complete: true },
      convergenceRate: {
        value: 2 / 3,
        converged: 2,
        samples: 3,
        complete: true,
      },
      duplicateFullSuiteRate: {
        fullSuiteExecutions: 2,
        duplicateExecutions: 1,
        rate: 0.5,
        complete: true,
      },
      ciMinutes: { used: 70, included: 3000 },
      findingDispositions: {
        confirmed: 3,
        refuted: 2,
        escaped: 1,
        source: "signed-ledger.jsonl",
      },
    });
    expect(report.population.preflightRecordsIgnored).toBe(0);
    expect(report.completeness.reasons).toEqual([]);
  });

  it("deduplicates invocations and labels malformed or historical data incomplete", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quality-report-"));
    const file = path.join(directory, "sample.jsonl");
    const old = record({
      invocationId: "same",
      recordedAt: "2026-08-12T00:00:00Z",
    });
    const latest = record({
      telemetrySchemaVersion: 6,
      invocationId: "same",
      recordedAt: "2026-08-13T00:00:00Z",
      testSelectionMode: undefined,
    });
    fs.writeFileSync(
      file,
      `${JSON.stringify(old)}\nnot-json\n${JSON.stringify(latest)}\n`,
    );
    const loaded = loadTelemetry([file]);
    expect(loaded).toMatchObject({
      rawRecordCount: 2,
      duplicateRecordCount: 1,
      malformedLines: 1,
    });
    const report = buildReport(loaded, {
      ciEvidence: {
        value: null,
        complete: false,
        reason: "ci-snapshot-not-provided",
      },
      dispositionEvidence: {
        value: null,
        complete: false,
        reason: "finding-dispositions-not-provided",
      },
      generatedAt: "2026-08-13T01:00:00Z",
    });
    expect(report.completeness).toMatchObject({
      telemetry: false,
      testSelection: false,
      ciMinutes: false,
      findingDispositions: false,
    });
    expect(report.completeness.reasons).toContain(
      "historical-records-missing-test-selection",
    );
  });

  it("counts valid JSON non-record values as unsupported without aborting", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "quality-values-"));
    const file = path.join(directory, "sample.jsonl");
    fs.writeFileSync(file, `null\n[]\n"text"\n${JSON.stringify(record())}\n`);
    const loaded = loadTelemetry([file]);
    expect(loaded).toMatchObject({
      rawRecordCount: 1,
      unsupportedRecords: 3,
    });
    expect(loaded.records).toHaveLength(1);
  });

  it("uses older records only for metrics they actually contain", () => {
    const old = record({
      telemetrySchemaVersion: 1,
      fallbackUsed: undefined,
      testSelectionMode: undefined,
    });
    const current = record({ invocationId: "current", fallbackUsed: true });
    const report = buildReport(
      {
        records: [old, current],
        rawRecordCount: 2,
        duplicateRecordCount: 0,
        malformedLines: 0,
        unsupportedRecords: 0,
      },
      {
        ciEvidence: {
          value: null,
          complete: false,
          reason: "ci-snapshot-not-provided",
        },
        dispositionEvidence: {
          value: null,
          complete: false,
          reason: "finding-dispositions-not-provided",
        },
        generatedAt: "2026-08-13T01:00:00Z",
      },
    );
    expect(report.metrics.fallbackRate).toMatchObject({
      value: 1,
      fallbacks: 1,
      samples: 1,
      complete: false,
    });
    expect(report.completeness.telemetry).toBe(true);
    expect(report.completeness.reasons).toContain(
      "historical-records-missing-fallback-attribution",
    );
  });

  it("excludes telemetry preflight probes from campaign metrics", () => {
    const report = buildReport(
      {
        records: [record({ preflight: true, durationSeconds: 999 }), record()],
        rawRecordCount: 2,
        duplicateRecordCount: 0,
        malformedLines: 0,
        unsupportedRecords: 0,
      },
      {
        ciEvidence: {
          value: null,
          complete: false,
          reason: "ci-snapshot-not-provided",
        },
        dispositionEvidence: {
          value: null,
          complete: false,
          reason: "finding-dispositions-not-provided",
        },
        generatedAt: "2026-08-13T01:00:00Z",
      },
    );
    expect(report.population).toMatchObject({
      campaigns: 1,
      preflightRecordsIgnored: 1,
    });
    expect(report.metrics.durationSeconds.p50).toBe(20);
  });

  it("validates explicit evidence instead of inferring unavailable values", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "quality-evidence-"),
    );
    const invalid = path.join(directory, "invalid.json");
    fs.writeFileSync(invalid, "{}");
    expect(readEvidence(invalid, validCiSnapshot, "ci-snapshot")).toMatchObject(
      { complete: false },
    );
    expect(
      validCiSnapshot({
        schemaVersion: 1,
        usedMinutes: 1,
        includedMinutes: 2,
        fetchedAt: "2026-08-13T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      validCiSnapshot({
        schemaVersion: 1,
        usedMinutes: -1,
        includedMinutes: 3000,
        fetchedAt: "2026-08-13T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      validCiSnapshot({
        schemaVersion: 1,
        usedMinutes: 3045,
        includedMinutes: 3000,
        fetchedAt: "2026-08-13T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      validDispositions({
        schemaVersion: 1,
        confirmed: 1,
        refuted: 0,
        escaped: 0,
        source: "ledger.jsonl",
        asOf: "2026-08-13T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      validDispositions({
        schemaVersion: 1,
        confirmed: -1,
        refuted: 0,
        escaped: 0,
        source: "ledger.jsonl",
        asOf: "2026-08-13T00:00:00Z",
      }),
    ).toBe(false);
  });
});
