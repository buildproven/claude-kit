const fs = require("fs");
const os = require("os");
const path = require("path");
const invocation = require("../quality-invocation");

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
// and rejects any manifest whose path does not match, so the fixture must build
// the canonical path rather than an arbitrary temp dir.
let uniqueKey = 0;

function writeManifest(overrides = {}) {
  const invocationId = "2f1a9c60-1c9d-5b2e-9a44-7c0d1e2f3a4b";
  const baseSha = "a".repeat(40);
  const pr = 1;
  // A distinct repo key per manifest keeps concurrent tests from colliding on
  // the same canonical state root.
  const repoKey = `test${String(uniqueKey++).padStart(12, "0")}`;
  const stateRoot = path.join(
    fs.realpathSync(process.env.TMPDIR || os.tmpdir()),
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

  it("marks the manifest terminal for isTerminal", () => {
    const manifestPath = writeManifest();
    invocation.recordTerminalState(manifestPath, "verified-unmerged");
    const { manifest } = invocation.loadManifest(manifestPath);
    expect(invocation.isTerminal(manifest)).toBe(true);
  });
});
