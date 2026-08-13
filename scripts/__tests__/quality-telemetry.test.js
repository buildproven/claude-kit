const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveTelemetryFile,
  successfulReviewCount,
  deriveVerdict,
  buildRecord,
  reviewTokenProxy,
  deterministicBlockingCount,
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
      { status: "success", round: 1, to: "bbb", leadCount: 0 },
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

  it("does not report a v2 deterministic block as authorized", () => {
    const manifest = baseManifest({
      reviewContractVersion: 2,
      options: { merge: true },
      judge: undefined,
      terminalState: { state: "blocked", detail: "ci:required" },
    });
    expect(deriveVerdict(manifest)).toBe("blocked");
    expect(deterministicBlockingCount(manifest)).toBe(1);
  });
});

describe("buildRecord", () => {
  it("summarizes a passed campaign from the manifest", () => {
    const rec = buildRecord(baseManifest(), {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(rec).toMatchObject({
      telemetrySchemaVersion: 7,
      invocationId: "11111111-1111-4111-8111-111111111111",
      repoKey: "target-repo",
      taskType: "feature",
      riskTier: "medium",
      riskScore: 61,
      reviewArm: "bespoke",
      reviewProvider: "codex",
      reviewModel: "gpt-5.6-terra",
      requestedProvider: null,
      providersAttempted: [],
      fallbackUsed: false,
      reviewEffort: "high",
      reviewTokens: null,
      reviewInputChars: null,
      reviewInputTokensEstimated: null,
      reviewOutputChars: null,
      reviewOutputTokensEstimated: null,
      reviewTokenEstimateSource: null,
      reviewStatus: "complete",
      leadCount: 0,
      durationSeconds: 0, // start 1000 > now 600 → clamps to 0
      providerDurationSeconds: null,
      gateDurationSeconds: null,
      fixCommitCount: 0,
      evidenceReusedCount: 0,
      testSelectionMode: null,
      terminalState: null,
      reviewRounds: 1,
      agentsRun: 2,
      blockingCount: 0,
      mergeRequested: false,
      verdict: "passed",
    });
  });

  it("records the persisted affected-test mode without re-deriving the plan", () => {
    const rec = buildRecord(
      baseManifest({
        requiredGates: [
          {
            name: "test",
            source: "test-impact:.buildproven/test-impact.json",
            testImpactMode: "audit",
          },
        ],
      }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(rec.testSelectionMode).toBe("audit");
  });

  it("labels a conventional repository test gate as complete regression", () => {
    const rec = buildRecord(
      baseManifest({
        requiredGates: [{ name: "test", source: "package-script:test" }],
      }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(rec.testSelectionMode).toBe("complete");
  });

  it("measures provider prompt/output artifacts with an explicit estimate label", () => {
    const artifactDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "qtel-artifacts-"),
    );
    fs.writeFileSync(path.join(artifactDir, "codex-1.prompt"), "12345678");
    fs.writeFileSync(path.join(artifactDir, "codex-1.normalized.json"), "1234");
    try {
      const record = buildRecord(
        baseManifest({
          reviews: [
            {
              status: "success",
              round: 1,
              to: "bbb",
              leadCount: 0,
              provider: "codex",
              artifactDir,
            },
          ],
        }),
        { execFileSync: NO_FILES, nowIso: NOW },
      );
      expect(record).toMatchObject({
        reviewInputChars: 8,
        reviewInputTokensEstimated: 2,
        reviewOutputChars: 4,
        reviewOutputTokensEstimated: 1,
        reviewTokenEstimateSource: "artifact-chars/4",
        reviewTokens: null,
      });
      expect(
        reviewTokenProxy(
          baseManifest({ reviews: [{ provider: "codex", artifactDir }] }),
        ),
      ).toMatchObject({ reviewInputTokensEstimated: 2 });
    } finally {
      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  });

  it("distinguishes configured diversity from an actual fallback", () => {
    const diversity = buildRecord(
      baseManifest({
        provider: { primary: "codex", reviewer: "codex", effort: "high" },
        reviews: [
          { status: "success", provider: "codex", to: "bbb" },
          { status: "success", provider: "claude", to: "bbb" },
        ],
      }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(diversity.fallbackUsed).toBe(false);
    const fallback = buildRecord(
      baseManifest({
        provider: { primary: "codex", reviewer: "claude", effort: "high" },
        reviews: [{ status: "success", provider: "claude", to: "bbb" }],
      }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(fallback.fallbackUsed).toBe(true);
  });

  it("does not follow a symlinked review artifact", () => {
    const artifactDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "qtel-symlink-artifacts-"),
    );
    const target = path.join(artifactDir, "target.txt");
    const link = path.join(artifactDir, "codex-1.prompt");
    fs.writeFileSync(target, "secret-context");
    fs.symlinkSync(target, link);
    try {
      expect(
        reviewTokenProxy(
          baseManifest({
            reviews: [{ provider: "codex", artifactDir }],
          }),
        ).reviewInputChars,
      ).toBeNull();
    } finally {
      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  });

  it("records v2 lead/status attribution without a judge", () => {
    const manifest = baseManifest({
      reviewContractVersion: 2,
      judge: undefined,
      reviews: [
        {
          status: "incomplete",
          provider: "review-incomplete",
          round: 1,
          to: "bbb",
          leadCount: 0,
        },
      ],
      provider: { reviewer: "review-incomplete", effort: "high" },
    });
    const record = buildRecord(manifest, {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(record).toMatchObject({
      verdict: "passed",
      blockingCount: 0,
      reviewStatus: "incomplete",
      leadCount: 0,
    });
  });

  it("separates provider execution time and exact terminal outcome", () => {
    const manifest = baseManifest({
      reviewContractVersion: 2,
      terminalState: { state: "superseded", detail: "head moved" },
      governor: { startedAtEpoch: 1000, providerSecondsUsed: 137 },
    });
    const record = buildRecord(manifest, {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(record).toMatchObject({
      durationSeconds: 0,
      providerDurationSeconds: 137,
      terminalState: "superseded",
      verdict: "incomplete",
    });
  });

  it("retains leads and incomplete status across all covered review rounds", () => {
    const manifest = baseManifest({
      reviewContractVersion: 2,
      judge: undefined,
      reviews: [
        {
          status: "incomplete",
          round: 1,
          from: "aaa",
          to: "ccc",
          leadCount: 2,
        },
        {
          status: "success",
          round: 2,
          from: "ccc",
          to: "bbb",
          leadCount: 1,
        },
      ],
    });
    const record = buildRecord(manifest, {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(record).toMatchObject({
      reviewStatus: "incomplete",
      leadCount: 3,
      blockingCount: 0,
    });
  });

  it("reports a successful same-range retry complete while retaining all leads", () => {
    const manifest = baseManifest({
      reviewContractVersion: 2,
      judge: undefined,
      reviews: [
        {
          status: "incomplete",
          provider: "review-incomplete",
          round: 1,
          from: "aaa",
          to: "bbb",
          leadCount: 2,
        },
        {
          status: "success",
          round: 1,
          from: "aaa",
          to: "bbb",
          leadCount: 1,
        },
      ],
    });
    const record = buildRecord(manifest, {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(record).toMatchObject({
      reviewStatus: "complete",
      leadCount: 3,
      blockingCount: 0,
    });
  });

  it("counts current-head deterministic gate failures for v2", () => {
    const manifest = baseManifest({
      reviewContractVersion: 2,
      judge: undefined,
      terminalState: { state: "blocked", detail: "gate:test" },
      gates: [
        { name: "test", head: "bbb", status: "failed" },
        { name: "lint", head: "bbb", status: "timeout" },
        { name: "security", head: "old", status: "failed" },
      ],
    });
    const record = buildRecord(manifest, {
      execFileSync: NO_FILES,
      nowIso: NOW,
    });
    expect(record).toMatchObject({ verdict: "blocked", blockingCount: 2 });
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

  it("infers an arm for pre-attribution manifests from the actual reviewer", () => {
    const record = buildRecord(
      baseManifest({
        options: { merge: false },
        provider: { reviewer: "codex", effort: "high" },
      }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(record.reviewArm).toBe("native");
    expect(validateRecord(record)).toBe(true);
  });

  it("keeps unattributed and legacy records readable without counting them as an arm", () => {
    const unattributed = buildRecord(
      baseManifest({
        options: { merge: false },
        provider: {},
        reviews: [],
      }),
      { execFileSync: NO_FILES, nowIso: NOW },
    );
    expect(unattributed.reviewArm).toBeNull();
    expect(validateRecord(unattributed)).toBe(true);

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
