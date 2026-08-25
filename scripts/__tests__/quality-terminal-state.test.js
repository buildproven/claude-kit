const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const invocation = require("../quality-invocation");
const lease = require("../quality-repo-lease");
const INVOCATION = path.join(__dirname, "..", "quality-invocation.js");

// ---------------------------------------------------------------------------
// A campaign ends in exactly ONE recorded terminal state.
//
// Before this existed, a campaign killed mid-flight left a manifest
// byte-identical to one still running (activeExecution is null in both cases),
// so "paused", "timed out", and "in progress" were indistinguishable on disk.
// Nine PR-267 manifests were in exactly that condition.
//
// Write-once is the load-bearing property: interruption and cleanup race, and
// the path that runs second must not be able to relabel the outcome.
// ---------------------------------------------------------------------------

// loadManifest re-derives stateRoot from (repoKey, pr, baseSha, invocationId)
// under qualityTmpRoot() and rejects any manifest whose path does not match, so
// the fixture cannot simply use an arbitrary temp dir — it must produce the
// canonical path.
//
// Building that path directly under the shared os.tmpdir() would be a
// predictable location another user could pre-create or symlink before us
// (CodeQL js/insecure-temporary-file, high). Instead, create ONE unpredictable
// private root with mkdtemp and point TMPDIR at it for the duration of the
// suite: qualityTmpRoot() reads TMPDIR, so the derivation still resolves, but
// every path now sits inside a directory only this process can name.
let sandboxRoot;
let previousTmpdir;
let uniqueKey = 0;

beforeAll(() => {
  previousTmpdir = process.env.TMPDIR;
  sandboxRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "quality-terminal-state-")),
  );
  process.env.TMPDIR = sandboxRoot;
});

afterAll(() => {
  if (previousTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = previousTmpdir;
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

function writeManifest(overrides = {}) {
  const invocationId = "2f1a9c60-1c9d-5b2e-9a44-7c0d1e2f3a4b";
  const baseSha = "a".repeat(40);
  const pr = 1;
  // A distinct repo key per manifest keeps tests from colliding on the same
  // canonical state root.
  const repoKey = `test${String(uniqueKey++).padStart(12, "0")}`;
  const stateRoot = path.join(
    sandboxRoot,
    "bs-quality",
    repoKey,
    `pr-${pr}`,
    baseSha,
    invocationId,
  );
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(stateRoot, "invocation.json");
  const manifest = {
    schemaVersion: invocation.SCHEMA_VERSION,
    manifestRevision: 1,
    invocationId,
    stateRoot,
    repo: { realpath: stateRoot, key: repoKey, pr },
    revisions: {
      baseRef: "origin/main",
      baseSha,
      baseHeadSha: baseSha,
      initialHead: "b".repeat(40),
      currentHead: "b".repeat(40),
    },
    risk: { tier: "high", mergeAuthority: "autonomous" },
    ...overrides,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

function readState(manifestPath) {
  return invocation.loadManifest(manifestPath).manifest.terminalState;
}

describe("terminal state normalization", () => {
  it("treats a manifest with no terminalState as still open", () => {
    const manifestPath = writeManifest();
    const { manifest } = invocation.loadManifest(manifestPath);
    expect(manifest.terminalState).toBeNull();
    expect(invocation.isTerminal(manifest)).toBe(false);
  });
});

describe("recordTerminalState", () => {
  it("records terminal telemetry through the public CLI seam", () => {
    const manifestPath = writeManifest({ reviewContractVersion: 2 });
    const telemetryPath = path.join(sandboxRoot, "terminal-telemetry.jsonl");
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "terminal-state",
        manifestPath,
        "--state",
        "verified-unmerged",
        "--detail",
        "deterministic evidence complete",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BS_QUALITY_TELEMETRY_FILE: telemetryPath,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("verified-unmerged\n");
    const repeated = spawnSync(
      "node",
      [
        INVOCATION,
        "terminal-state",
        manifestPath,
        "--state",
        "verified-unmerged",
        "--detail",
        "deterministic evidence complete",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BS_QUALITY_TELEMETRY_FILE: telemetryPath,
        },
      },
    );
    expect(repeated.status).toBe(0);
    expect(repeated.stdout).toBe("verified-unmerged\n");
    const records = fs
      .readFileSync(telemetryPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      invocationId: "2f1a9c60-1c9d-5b2e-9a44-7c0d1e2f3a4b",
      terminalState: "verified-unmerged",
      verdict: "passed",
    });
  });

  it("keeps the terminal outcome when telemetry persistence fails", () => {
    const manifestPath = writeManifest({ reviewContractVersion: 2 });
    const result = spawnSync(
      "node",
      [
        INVOCATION,
        "terminal-state",
        manifestPath,
        "--state",
        "verified-unmerged",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BS_QUALITY_TELEMETRY_FILE: sandboxRoot,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("verified-unmerged\n");
    expect(result.stderr).toMatch(/telemetry: could not write/);
    expect(readState(manifestPath).state).toBe("verified-unmerged");
  });

  it("records the state, head, and timestamp", () => {
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "timeout", "provider-timeout");

    const state = readState(manifestPath);
    expect(state.state).toBe("timeout");
    expect(state.detail).toBe("provider-timeout");
    expect(state.head).toBe("b".repeat(40));
    expect(Date.parse(state.recordedAt)).not.toBeNaN();
  });

  it("rejects a state outside the known set", () => {
    const manifestPath = writeManifest();
    expect(() =>
      invocation.recordTerminalState(manifestPath, "sort-of-done"),
    ).toThrow(/unknown terminal state/);
    expect(readState(manifestPath)).toBeNull();
  });

  it("keeps the FIRST cause when a second, different one arrives", () => {
    // The race this guards: a campaign times out, then a cleanup handler fires
    // on the way down and tries to record "interrupted". The outcome must stay
    // "timeout" — the reason it actually ended.
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "timeout", "budget exhausted");
    const inForce = invocation.recordTerminalState(manifestPath, "interrupted");

    expect(inForce).toBe("timeout");
    expect(readState(manifestPath).state).toBe("timeout");
    expect(readState(manifestPath).detail).toBe("budget exhausted");
  });

  it("cannot be relabelled from blocked to merged", () => {
    // The dangerous direction: a failed campaign must never be able to present
    // itself as merged.
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "blocked", "gate:test");

    expect(invocation.recordTerminalState(manifestPath, "merged")).toBe(
      "blocked",
    );
    expect(readState(manifestPath).state).toBe("blocked");
  });

  it("is idempotent when the same state is recorded twice", () => {
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "merged");
    const first = readState(manifestPath).recordedAt;

    expect(invocation.recordTerminalState(manifestPath, "merged")).toBe(
      "merged",
    );
    expect(readState(manifestPath).recordedAt).toBe(first);
  });

  it("truncates an unbounded detail string", () => {
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "blocked", "x".repeat(5000));
    expect(readState(manifestPath).detail).toHaveLength(500);
  });

  it("does not bump manifestRevision", () => {
    // The recorder runs as a separate process after a failing step has exited,
    // while that step may still hold an open withManifestLock() transaction
    // which compares manifestRevision before/after its OWN mutation to detect a
    // concurrent writer. Bumping here makes that check misfire on a phantom
    // writer — it broke the abandoned-execution reconciliation path.
    const manifestPath = writeManifest({ manifestRevision: 7 });
    invocation.recordTerminalState(manifestPath, "blocked", "gate:test");

    const written = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(written.manifestRevision).toBe(7);
    expect(written.terminalState.state).toBe("blocked");
  });

  it("rejects a terminal writer from an earlier recovery epoch", () => {
    const manifestPath = writeManifest({ terminalEpoch: 2 });

    expect(() =>
      invocation.recordTerminalState(manifestPath, "blocked", "late merge", {
        terminalEpoch: 1,
      }),
    ).toThrow(/terminal writer epoch is stale/);
    expect(readState(manifestPath)).toBeNull();
  });

  it("replaces only a matching recovering sentinel", () => {
    const manifestPath = writeManifest({
      terminalEpoch: 2,
      terminalState: {
        state: "recovering",
        head: "b".repeat(40),
        terminalEpoch: 2,
      },
    });

    expect(
      invocation.recordTerminalState(manifestPath, "merged", "pr:1", {
        terminalEpoch: 2,
      }),
    ).toBe("merged");
    expect(readState(manifestPath)).toMatchObject({
      state: "merged",
      terminalEpoch: 2,
    });
  });

  it("lets a reconciled merge receipt replace its sentinel without an ambient epoch", () => {
    const manifestPath = writeManifest({
      terminalEpoch: 2,
      terminalState: {
        state: "recovering",
        head: "b".repeat(40),
        terminalEpoch: 2,
      },
    });
    const previousEpoch = process.env.BS_QUALITY_TERMINAL_EPOCH;
    delete process.env.BS_QUALITY_TERMINAL_EPOCH;
    try {
      lease._recordMergedTerminalRaw(manifestPath);
    } finally {
      if (previousEpoch === undefined)
        delete process.env.BS_QUALITY_TERMINAL_EPOCH;
      else process.env.BS_QUALITY_TERMINAL_EPOCH = previousEpoch;
    }

    expect(readState(manifestPath)).toMatchObject({
      state: "merged",
      terminalEpoch: 2,
    });
  });

  it("binds a typed merge-admission block to the blocked terminal record", () => {
    const manifestPath = writeManifest({ options: { merge: true } });
    invocation.recordMergeAdmissionBlock(manifestPath, ["ci:failed"]);
    invocation.recordTerminalState(
      manifestPath,
      "blocked",
      "merge admission failed",
    );

    expect(readState(manifestPath)).toMatchObject({
      state: "blocked",
      mergeAdmissionConditions: ["ci:failed"],
    });
  });

  it("does not carry an earlier admission block into the next merge attempt", () => {
    const manifestPath = writeManifest({ options: { merge: true } });
    invocation.recordMergeAdmissionBlock(manifestPath, ["ci:failed"]);

    expect(invocation.clearMergeAdmissionBlock(manifestPath)).toBe(true);
    invocation.recordTerminalState(manifestPath, "blocked", "gate:test");

    expect(readState(manifestPath)).not.toHaveProperty(
      "mergeAdmissionConditions",
    );
  });

  it("marks the manifest terminal for isTerminal", () => {
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "verified-unmerged");
    const { manifest } = invocation.loadManifest(manifestPath);
    expect(invocation.isTerminal(manifest)).toBe(true);
  });

  it.each([
    "provider-incomplete",
    "provider-contract-failed",
    "policy-superseded",
  ])("prevents review re-entry after %s", (state) => {
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, state, "bounded failure");
    const result = spawnSync(
      "node",
      [INVOCATION, "review-info", manifestPath],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/campaign is terminal/);
  });
});
