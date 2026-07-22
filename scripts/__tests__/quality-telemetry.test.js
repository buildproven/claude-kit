const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveTelemetryFile,
  successfulReviewCount,
  deriveVerdict,
  buildRecord,
  validateRecord,
  alreadyRecorded,
  recordCampaign,
} = require("../quality-telemetry");

function baseManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    invocationId: "11111111-1111-4111-8111-111111111111",
    stateRoot: "/does/not/matter",
    options: { merge: false, reviewArm: "bespoke" },
    repo: {
      realpath: "/tmp/target-repo",
      key: "target-repo",
      pr: null,
      githubRepository: "acme/target-repo",
      headRefName: "feat/x",
    },
    revisions: { baseSha: "aaa", currentHead: "bbb" },
    risk: {
      resolved: true,
      taskType: "feature",
      tier: "medium",
      score: 61,
      requestedLevel: "auto",
    },
    agents: [{ name: "code-reviewer" }, { name: "security-auditor" }],
    provider: { reviewer: "codex", effort: "high" },
    reviews: [
      { status: "success", round: 1 },
      { status: "failed", round: 1 },
    ],
    governor: { startedAtEpoch: 1000 },
    judge: { blockingCount: 0, head: "bbb" },
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

  it("defaults outside the audited target repository", () => {
    delete process.env.BS_QUALITY_TELEMETRY_FILE;
    const telemetry = resolveTelemetryFile(baseManifest());
    expect(telemetry).not.toContain("/tmp/target-repo/");
    expect(telemetry).toMatch(
      /claude-kit[/\\]quality-telemetry[/\\]target-repo\.jsonl$/,
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
  it("authorized (not merged) when merge requested and judge clears it", () => {
    const m = baseManifest({
      options: { merge: true },
      judge: { blockingCount: 0, head: "bbb" },
    });
    // "authorized" is deliberate: the judge cleared the merge, but the actual
    // GitHub merge can still abort (red CI, stale trailers). We never claim
    // "merged" from manifest state the merge step doesn't update.
    expect(deriveVerdict(m)).toBe("authorized");
  });
  it("passed when clean but no merge asked", () => {
    expect(deriveVerdict(baseManifest())).toBe("passed");
  });
  it("blocked when blocking findings remain", () => {
    expect(
      deriveVerdict(baseManifest({ judge: { blockingCount: 3, head: "bbb" } })),
    ).toBe("blocked");
  });
  it("incomplete when no judge artifact", () => {
    expect(deriveVerdict(baseManifest({ judge: undefined }))).toBe(
      "incomplete",
    );
  });
  it("incomplete when the judge is bound to a stale head", () => {
    // Judge recorded against an old head, then commits landed and moved
    // currentHead without a re-judge — the last commits went unreviewed, so
    // the stale blocking count cannot be trusted for the recorded head.
    const m = baseManifest({
      options: { merge: true },
      revisions: { baseSha: "aaa", currentHead: "ccc" },
      judge: { blockingCount: 0, head: "bbb" },
    });
    expect(deriveVerdict(m)).toBe("incomplete");
  });
});

describe("buildRecord", () => {
  it("summarizes a passed campaign from the manifest", () => {
    const rec = buildRecord(baseManifest(), {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(rec).toMatchObject({
      telemetrySchemaVersion: 2,
      invocationId: "11111111-1111-4111-8111-111111111111",
      repoKey: "target-repo",
      taskType: "feature",
      riskTier: "medium",
      riskScore: 61,
      reviewArm: "bespoke",
      reviewProvider: "codex",
      reviewEffort: "high",
      reviewTokens: null,
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
    expect(rec.taskType).toBeNull();
  });

  it("accepts nullable tokens and rejects an unknown review arm", () => {
    const record = buildRecord(baseManifest(), {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(validateRecord(record)).toBe(true);
    expect(validateRecord({ ...record, reviewArm: "unknown" })).toBe(false);
  });

  it("keeps legacy records readable without treating them as current schema", () => {
    const legacy = { telemetrySchemaVersion: 1, invocationId: "legacy" };
    expect(validateRecord(legacy)).toBe(false);
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
    delete process.env.XDG_STATE_HOME;
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

  it("leaves a previously clean target tree unchanged by default", () => {
    const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "qtel-state-"));
    process.env.XDG_STATE_HOME = stateHome;
    const before = fs.readdirSync(repoDir, { recursive: true }).sort();

    expect(
      recordCampaign(manifestPath, {
        execFileSync: NO_FILES,
        nowIso: NOW,
      }),
    ).toBe(0);

    expect(fs.readdirSync(repoDir, { recursive: true }).sort()).toEqual(before);
    expect(
      fs.existsSync(
        path.join(
          stateHome,
          "claude-kit",
          "quality-telemetry",
          "target-repo.jsonl",
        ),
      ),
    ).toBe(true);
    fs.rmSync(stateHome, { recursive: true, force: true });
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
