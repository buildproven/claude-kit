const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveTelemetryFile,
  successfulReviewCount,
  deriveVerdict,
  buildRecord,
  alreadyRecorded,
  recordCampaign,
} = require("../quality-telemetry");

function baseManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    invocationId: "11111111-1111-4111-8111-111111111111",
    stateRoot: "/does/not/matter",
    options: { merge: false },
    repo: {
      realpath: "/tmp/target-repo",
      key: "target-repo",
      pr: null,
      githubRepository: "acme/target-repo",
      headRefName: "feat/x",
    },
    revisions: { baseSha: "aaa", currentHead: "bbb" },
    risk: { resolved: true, tier: "medium", score: 61, requestedLevel: "auto" },
    agents: [{ name: "code-reviewer" }, { name: "security-auditor" }],
    reviews: [
      { status: "success", round: 1 },
      { status: "failed", round: 1 },
    ],
    governor: { startedAtEpoch: 1000 },
    judge: { blockingCount: 0 },
    ...overrides,
  };
}

const NO_FILES = () => "";
const NOW = "1970-01-01T00:10:00.000Z"; // epoch 600

describe("resolveTelemetryFile", () => {
  const original = process.env.BS_QUALITY_TELEMETRY_FILE;
  afterEach(() => {
    if (original === undefined) delete process.env.BS_QUALITY_TELEMETRY_FILE;
    else process.env.BS_QUALITY_TELEMETRY_FILE = original;
  });

  it("defaults to the target repo's data dir", () => {
    delete process.env.BS_QUALITY_TELEMETRY_FILE;
    expect(resolveTelemetryFile(baseManifest())).toBe(
      "/tmp/target-repo/data/quality-telemetry.jsonl",
    );
  });

  it("honors the env override", () => {
    process.env.BS_QUALITY_TELEMETRY_FILE = "/committed/telemetry.jsonl";
    expect(resolveTelemetryFile(baseManifest())).toBe(
      "/committed/telemetry.jsonl",
    );
  });
});

describe("successfulReviewCount", () => {
  it("counts only successful reviews", () => {
    expect(successfulReviewCount(baseManifest())).toBe(1);
  });
  it("is 0 with no reviews array", () => {
    expect(successfulReviewCount(baseManifest({ reviews: undefined }))).toBe(0);
  });
});

describe("deriveVerdict", () => {
  it("merged when merge requested and judge clears it", () => {
    const m = baseManifest({
      options: { merge: true },
      judge: { blockingCount: 0 },
    });
    expect(deriveVerdict(m)).toBe("merged");
  });
  it("passed when clean but no merge asked", () => {
    expect(deriveVerdict(baseManifest())).toBe("passed");
  });
  it("blocked when blocking findings remain", () => {
    expect(deriveVerdict(baseManifest({ judge: { blockingCount: 3 } }))).toBe(
      "blocked",
    );
  });
  it("incomplete when no judge artifact", () => {
    expect(deriveVerdict(baseManifest({ judge: undefined }))).toBe(
      "incomplete",
    );
  });
});

describe("buildRecord", () => {
  it("summarizes a passed campaign from the manifest", () => {
    const rec = buildRecord(baseManifest(), {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(rec).toMatchObject({
      telemetrySchemaVersion: 1,
      invocationId: "11111111-1111-4111-8111-111111111111",
      repoKey: "target-repo",
      riskTier: "medium",
      riskScore: 61,
      durationSeconds: 0, // start 1000 > now 600 → clamps to 0
      reviewRounds: 1,
      agentsRun: 2,
      blockingCount: 0,
      mergeRequested: false,
      verdict: "passed",
    });
  });

  it("never records the absolute repo path (no host-path leak — BUI-351)", () => {
    const rec = buildRecord(baseManifest(), {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(rec).not.toHaveProperty("repoPath");
    // No value in the record should contain the manifest's filesystem realpath.
    expect(JSON.stringify(rec)).not.toContain("/tmp/target-repo");
  });

  it("clamps negative durations to 0 and records covered files", () => {
    const rec = buildRecord(
      baseManifest({ governor: { startedAtEpoch: 300 } }),
      {
        execFileSync: () => "src/a.js\nsrc/b.js\n",
        nowIso: NOW, // epoch 600
      },
    );
    expect(rec.durationSeconds).toBe(300);
    expect(rec.coveredFiles).toEqual(["src/a.js", "src/b.js"]);
  });

  it("nulls risk fields when risk unresolved", () => {
    const rec = buildRecord(
      baseManifest({ risk: { resolved: false, requestedLevel: "auto" } }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(rec.riskTier).toBeNull();
    expect(rec.riskScore).toBeNull();
  });
});

describe("alreadyRecorded", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "qtel-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("false when file absent", () => {
    expect(alreadyRecorded(path.join(dir, "none.jsonl"), "x")).toBe(false);
  });

  it("true when id present, skipping corrupt lines", () => {
    const p = path.join(dir, "t.jsonl");
    fs.writeFileSync(
      p,
      "not json\n" + JSON.stringify({ invocationId: "abc" }) + "\n",
    );
    expect(alreadyRecorded(p, "abc")).toBe(true);
    expect(alreadyRecorded(p, "zzz")).toBe(false);
  });
});

describe("recordCampaign (idempotent append)", () => {
  let repoDir;
  let manifestPath;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "qtel-repo-"));
    // Write a manifest that passes loadManifest's stateRoot/path invariants.
    const invocationId = "22222222-2222-4222-8222-222222222222";
    const stateRoot = path.join(repoDir, ".state");
    fs.mkdirSync(stateRoot, { recursive: true });
    manifestPath = path.join(stateRoot, "invocation.json");
    const manifest = {
      ...baseManifest({ invocationId }),
      stateRoot,
      repo: {
        realpath: fs.realpathSync(repoDir),
        key: "target-repo",
        pr: null,
        githubRepository: "acme/target-repo",
        headRefName: "feat/x",
      },
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    delete process.env.BS_QUALITY_TELEMETRY_FILE;
  });

  it("appends exactly one line even when called twice", () => {
    const logPath = path.join(repoDir, "telemetry.jsonl");
    process.env.BS_QUALITY_TELEMETRY_FILE = logPath;
    const deps = { execFileSync: NO_FILES, nowIso: NOW };

    expect(recordCampaign(manifestPath, deps)).toBe(0);
    expect(recordCampaign(manifestPath, deps)).toBe(0);

    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).invocationId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("returns 1 on an unreadable manifest", () => {
    expect(recordCampaign(path.join(repoDir, "missing.json"))).toBe(1);
  });

  it("returns 1 on a manifest that is not valid JSON", () => {
    const bad = path.join(repoDir, ".state", "bad.json");
    fs.writeFileSync(bad, "{ not json");
    expect(recordCampaign(bad)).toBe(1);
  });
});
