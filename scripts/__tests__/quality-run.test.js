const {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const SOURCE_RUNNER = path.resolve(__dirname, "..", "quality-run.js");

const FAKE_INVOCATION = `
"use strict";
const fs = require("node:fs");
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function write(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
function loadManifest(file) { return { manifest: read(file), manifestPath: file }; }
function withManifestLock(file, mutation) {
  const manifest = read(file);
  if (manifest.options?.merge === true &&
      process.env.BS_QUALITY_REPOSITORY_LEASE_TOKEN !== manifest.merge?.repositoryLease?.token) {
    throw new Error("repository lease credential is required for manifest mutation");
  }
  mutation(manifest, file);
  manifest.manifestRevision = (manifest.manifestRevision || 0) + 1;
  write(file, manifest);
  return manifest;
}
function validateIdentity(manifest) {
  if (manifest.behavior?.stale) throw new Error("manifest HEAD identity is stale");
}
function terminalEpoch(manifest) { return manifest.terminalEpoch || 0; }
function resumeRecoverableTerminal(file) {
  const manifest = read(file);
  if (!manifest.behavior?.recoverTerminal || !["blocked", "recovering"].includes(manifest.terminalState?.state)) return null;
  const epoch = terminalEpoch(manifest) + 1;
  manifest.terminalHistory ||= [];
  if (manifest.terminalState.state === "blocked") {
    manifest.terminalHistory.push({ ...manifest.terminalState, disposition: "superseded-by-capability" });
  }
  manifest.terminalHistory.push({ event: "reopened-by-capability", terminalEpoch: epoch });
  manifest.terminalEpoch = epoch;
  manifest.terminalState = { state: "recovering", head: manifest.revisions.currentHead, terminalEpoch: epoch };
  write(file, manifest);
  return manifest.terminalState;
}
function clearMergeAdmissionBlock(file) {
  const manifest = read(file);
  if (!manifest.merge?.admissionBlock) return false;
  delete manifest.merge.admissionBlock;
  write(file, manifest);
  return true;
}
function mutationEvidenceValid(manifest) { return Boolean(manifest.mutation); }
function incompleteRetryStatus(manifest) {
  const incomplete = manifest.reviews.filter((review) => review.status === "incomplete");
  return { state: manifest.behavior?.retryPending && incomplete.length === 1 ? "pending" : "none" };
}
function reviewCoverage(manifest) {
  const exact = manifest.reviews.some((review) => review.to === manifest.revisions.currentHead);
  const carried = manifest.revisions.reviewRebaseCarries?.some((carry) =>
    carry.head === manifest.revisions.currentHead &&
    manifest.reviews.some((review) => review.to === carry.reviewedHead));
  if (!exact && !carried) {
    throw new Error("final HEAD has not been covered by review evidence");
  }
  if (manifest.gates.some((gate) => gate.status !== "success")) {
    throw new Error("required gate evidence is incomplete");
  }
}
function reviewAuthorization(manifest) {
  reviewCoverage(manifest);
  if (manifest.behavior?.approvalRequired) {
    throw new Error("a signed exact-head operator capability is required");
  }
  if (manifest.reviews.some((review) => review.status === "incomplete")) {
    throw new Error("required provider review is incomplete; a signed exact-head operator override is required");
  }
  return {};
}
function recordTerminalState(file, state, detail) {
  const manifest = read(file);
  if (!manifest.terminalState || manifest.terminalState.state === "recovering") {
    manifest.terminalState = { state, detail, head: manifest.revisions.currentHead };
  }
  write(file, manifest);
  return manifest.terminalState.state;
}
if (require.main === module) {
  const [, , command, file, ...args] = process.argv;
  if (command === "reserve-incomplete-retry") {
    const manifest = read(file);
    manifest.retryReserved = true;
    write(file, manifest);
    process.exit(0);
  }
  if (command !== "terminal-state") process.exit(2);
  if (read(file).behavior?.terminalRecorderFail) process.exit(7);
  const state = args[args.indexOf("--state") + 1];
  const detail = args[args.indexOf("--detail") + 1];
  const inForce = recordTerminalState(file, state, detail);
  const manifest = read(file);
  manifest.telemetryWrites = (manifest.telemetryWrites || 0) + 1;
  write(file, manifest);
  process.stdout.write(inForce + "\\n");
}
module.exports = { incompleteRetryStatus, loadManifest, mutationEvidenceValid, recordTerminalState,
  clearMergeAdmissionBlock, reviewAuthorization, reviewCoverage, resumeRecoverableTerminal, terminalEpoch, validateIdentity, withManifestLock };
`;

const FAKE_STEP = `
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const [step, ...args] = process.argv.slice(2);
const index = args.indexOf("--manifest");
const file = index >= 0 ? args[index + 1] : args[0];
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.calls ||= [];
manifest.calls.push(step);
if (step === "quality-risk-resolve.sh") manifest.risk.resolved = true;
if (step === "quality-risk-resolve.sh" && manifest.behavior?.failRisk) {
  fs.writeFileSync(file, JSON.stringify(manifest));
  process.exit(5);
}
if (step === "quality-select-agents.sh") manifest.panel = { rule: "fixture" };
if (step === "quality-run-gate.sh") {
  const name = args[args.indexOf("--name") + 1];
  if (manifest.behavior?.signalGate === name) {
    fs.writeFileSync(file, JSON.stringify(manifest));
    process.kill(process.ppid, "SIGTERM");
    setTimeout(() => {}, 5000);
    return;
  }
  if (manifest.behavior?.failGate === name) {
    manifest.gates.push({ name, status: "failed" });
    manifest.terminalState = { state: "blocked", detail: "gate:" + name };
    manifest.telemetryWrites = (manifest.telemetryWrites || 0) + 1;
    fs.writeFileSync(file, JSON.stringify(manifest));
    process.exit(1);
  }
  manifest.gates.push({ name, status: "success" });
}
if (step === "quality-mutation-check.sh") manifest.mutation = true;
if (step === "quality-run-review.sh") manifest.reviews.push({
  from: manifest.revisions.baseSha,
  to: manifest.revisions.currentHead,
  status: manifest.behavior?.incompleteReview ? "incomplete" :
    (manifest.risk.tier === "low" ? "exempt" : "complete"),
  leadCount: manifest.behavior?.leads || 0,
});
if (step === "quality-stamp-and-merge.sh") {
  if (manifest.behavior?.externalMergeRequirement) {
    fs.writeFileSync(file, JSON.stringify(manifest));
    process.stderr.write("protected base requires a signed capability\\n");
    process.exit(3);
  }
  if (manifest.behavior?.failMerge) {
    fs.writeFileSync(file, JSON.stringify(manifest));
    if (manifest.behavior.mergeWarning) {
      process.stderr.write(manifest.behavior.mergeWarning + "\\n");
    }
    process.stderr.write("required CI failed on exact candidate\\n");
    process.exit(1);
  }
  if (!manifest.behavior?.mergeWithoutTerminal) {
    if (manifest.behavior?.rewriteMergedHead) {
      manifest.revisions.currentHead = "rewritten999";
    }
    manifest.terminalState = { state: "merged", head: manifest.revisions.currentHead };
    manifest.telemetryWrites = (manifest.telemetryWrites || 0) + 1;
  }
}
fs.writeFileSync(file, JSON.stringify(manifest));
`;

function fixture(behavior = {}, { merge = false, tier = "low" } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "quality-run-"));
  const runtime = path.join(root, "scripts");
  mkdirSync(runtime);
  copyFileSync(SOURCE_RUNNER, path.join(runtime, "quality-run.js"));
  chmodSync(path.join(runtime, "quality-run.js"), 0o755);
  writeFileSync(path.join(runtime, "quality-invocation.js"), FAKE_INVOCATION);
  writeFileSync(path.join(runtime, "fake-step.js"), FAKE_STEP);
  for (const name of [
    "quality-risk-resolve.sh",
    "quality-select-agents.sh",
    "quality-run-gate.sh",
    "quality-mutation-check.sh",
    "quality-authorize-review-round.sh",
    "quality-run-review.sh",
    "quality-stamp-and-merge.sh",
  ]) {
    const file = path.join(runtime, name);
    writeFileSync(
      file,
      `#!/usr/bin/env bash\nexec node "${path.join(runtime, "fake-step.js")}" "${name}" "$@"\n`,
    );
    chmodSync(file, 0o755);
  }
  const manifestPath = path.join(root, "invocation.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      manifestRevision: 0,
      repo: { realpath: root },
      revisions: { currentHead: "abc123", baseSha: "base123" },
      options: { merge },
      ...(merge
        ? { merge: { repositoryLease: { token: "fixture-token" } } }
        : {}),
      risk: { resolved: false, tier },
      requiredGates: ["lint", "test", "security"].map((name) => ({ name })),
      gates: [],
      reviews: [],
      behavior,
    }),
  );
  return { manifestPath, runner: path.join(runtime, "quality-run.js") };
}

function run(entry) {
  const env = { ...process.env };
  delete env.BS_QUALITY_REPOSITORY_LEASE_TOKEN;
  const result = spawnSync(
    process.execPath,
    [entry.runner, "--manifest", entry.manifestPath],
    {
      encoding: "utf8",
      env,
      // The repository allows subprocess-heavy integration cases 60 seconds
      // under its eight-worker pool. Keep this fixture below that bound while
      // avoiding a machine-load-dependent false timeout.
      timeout: 30_000,
    },
  );
  return {
    ...result,
    manifest: JSON.parse(readFileSync(entry.manifestPath, "utf8")),
    output: result.stdout.trim().split("\n").at(-1),
  };
}

describe("quality-run public orchestration", () => {
  it("runs low-risk gates and review in order, records one terminal result, and reuses it", () => {
    const entry = fixture();
    const first = run(entry);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.output)).toMatchObject({
      status: "complete",
      state: "verified-unmerged",
      review: { status: "policy-exempt", leads: 0 },
    });
    expect(first.manifest.calls).toEqual([
      "quality-risk-resolve.sh",
      "quality-select-agents.sh",
      "quality-run-gate.sh",
      "quality-run-gate.sh",
      "quality-run-gate.sh",
      "quality-authorize-review-round.sh",
      "quality-run-review.sh",
    ]);
    expect(first.manifest.telemetryWrites).toBe(1);

    const resumed = run(entry);
    expect(resumed.status).toBe(0);
    expect(JSON.parse(resumed.output)).toMatchObject({
      status: "terminal",
      state: "verified-unmerged",
    });
    expect(resumed.manifest.calls).toEqual(first.manifest.calls);
    expect(resumed.manifest.telemetryWrites).toBe(1);
  });

  it("stops after a failed gate and never starts review", () => {
    const result = run(fixture({ failGate: "test" }));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "blocked",
    });
    expect(result.manifest.calls).not.toContain("quality-run-review.sh");
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("records signal interruption as one terminal campaign", () => {
    const result = run(fixture({ signalGate: "lint" }));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "interrupted",
    });
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("classifies stale identity as superseded before any phase runs", () => {
    const result = run(fixture({ stale: true }));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "superseded",
    });
    expect(result.manifest.calls).toBeUndefined();
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("keeps incomplete provider evidence honest for a no-merge audit", () => {
    const result = run(fixture({ incompleteReview: true }, { tier: "medium" }));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "provider-incomplete",
      review: { status: "incomplete" },
    });
    expect(result.manifest.reviews[0].status).toBe("incomplete");
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("resumes the authorized same-range retry after an interrupted incomplete review", () => {
    const entry = fixture(
      { incompleteReview: true, retryPending: true },
      { tier: "medium" },
    );
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.risk.resolved = true;
    manifest.gates = manifest.requiredGates.map(({ name }) => ({
      name,
      status: "success",
    }));
    manifest.reviews.push({
      from: manifest.revisions.baseSha,
      to: manifest.revisions.currentHead,
      status: "incomplete",
      leadCount: 0,
    });
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);
    expect(result.manifest.retryReserved).toBe(true);
    expect(result.manifest.calls).toContain(
      "quality-authorize-review-round.sh",
    );
    expect(result.manifest.reviews).toHaveLength(2);
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("reports a successful provider retry as complete", () => {
    const entry = fixture({ retryPending: true }, { tier: "medium" });
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.reviews.push({
      from: "base123",
      to: manifest.revisions.currentHead,
      status: "incomplete",
      leadCount: 0,
    });
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      review: { status: "complete" },
    });
  });

  it("reuses rebase-carried review coverage without relabeling it as policy-exempt", () => {
    const entry = fixture({}, { tier: "medium" });
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.revisions.currentHead = "rebased456";
    manifest.revisions.reviewRebaseCarries = [
      { reviewedHead: "abc123", head: "rebased456" },
    ];
    manifest.reviews = [{ to: "abc123", status: "complete", leadCount: 3 }];
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      review: { status: "complete", leads: 3 },
    });
    expect(result.manifest.calls).not.toContain(
      "quality-authorize-review-round.sh",
    );
    expect(result.manifest.calls).not.toContain("quality-run-review.sh");
  });

  it("pauses a merge only for a typed external capability requirement", () => {
    const result = run(
      fixture(
        { approvalRequired: true, leads: 2 },
        { merge: true, tier: "medium" },
      ),
    );
    expect(result.status).toBe(3);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "action-required",
      kind: "external-capability",
      phase: "authorization",
      review: { leads: 2 },
    });
    expect(result.manifest.terminalState).toBeUndefined();
    expect(result.manifest.calls).not.toContain("quality-stamp-and-merge.sh");
  });

  it("delegates an authorized merge to the protected merge script", () => {
    const result = run(fixture({}, { merge: true, tier: "medium" }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "complete",
      state: "merged",
    });
    expect(result.manifest.calls.at(-1)).toBe("quality-stamp-and-merge.sh");
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("continues only the explicitly recoverable terminal merge campaign", () => {
    const entry = fixture(
      { recoverTerminal: true },
      { merge: true, tier: "medium" },
    );
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.terminalState = {
      state: "blocked",
      detail: "merge admission failed",
      head: manifest.revisions.currentHead,
    };
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);

    expect(result.status).toBe(0);
    expect(result.manifest.terminalState).toMatchObject({ state: "merged" });
    expect(result.manifest.terminalHistory).toHaveLength(2);
    expect(result.manifest.terminalEpoch).toBe(1);
  });

  it("records a new terminal cause when a recovered merge fails", () => {
    const entry = fixture(
      { recoverTerminal: true, failMerge: true },
      { merge: true, tier: "medium" },
    );
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.terminalState = {
      state: "blocked",
      detail: "merge admission failed",
      head: manifest.revisions.currentHead,
    };
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "blocked",
    });
    expect(result.manifest.terminalState).toMatchObject({
      state: "blocked",
      detail: "merge admission failed with exit 1",
    });
  });

  it("keeps a recovered external merge requirement actionable", () => {
    const entry = fixture(
      { recoverTerminal: true, externalMergeRequirement: true },
      { merge: true, tier: "medium" },
    );
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.terminalState = {
      state: "blocked",
      detail: "merge admission failed",
      head: manifest.revisions.currentHead,
    };
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);

    expect(result.status).toBe(3);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "action-required",
      kind: "external-capability",
      phase: "merge",
    });
    expect(result.manifest.terminalState).toMatchObject({
      state: "recovering",
      terminalEpoch: 1,
    });
  });

  it("advances the epoch when a second runner re-enters recovery", () => {
    const entry = fixture(
      { recoverTerminal: true, externalMergeRequirement: true },
      { merge: true, tier: "medium" },
    );
    const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8"));
    manifest.terminalEpoch = 1;
    manifest.terminalHistory = [
      { event: "reopened-by-capability", terminalEpoch: 1 },
    ];
    manifest.terminalState = {
      state: "recovering",
      head: manifest.revisions.currentHead,
      terminalEpoch: 1,
    };
    writeFileSync(entry.manifestPath, JSON.stringify(manifest));

    const result = run(entry);

    expect(result.status).toBe(3);
    expect(result.manifest.terminalState).toMatchObject({
      state: "recovering",
      terminalEpoch: 2,
    });
    expect(result.manifest.terminalHistory.at(-1)).toMatchObject({
      event: "reopened-by-capability",
      terminalEpoch: 2,
    });
  });

  it("rejects merge exit zero without exact merged terminal evidence", () => {
    const result = run(
      fixture({ mergeWithoutTerminal: true }, { merge: true, tier: "medium" }),
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "blocked",
      message:
        "merge process exited successfully without exact-head merged terminal evidence",
    });
  });

  it("binds merged terminal evidence to the immutable pre-merge head", () => {
    const result = run(
      fixture({ rewriteMergedHead: true }, { merge: true, tier: "medium" }),
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "contract-failed",
      observedTerminalState: "merged",
      message:
        "merge process exited successfully without exact-head merged terminal evidence",
    });
  });

  it("uses the structured merge exit for an external governance capability", () => {
    const result = run(
      fixture(
        { externalMergeRequirement: true },
        { merge: true, tier: "medium" },
      ),
    );
    expect(result.status).toBe(3);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "action-required",
      kind: "external-capability",
      phase: "merge",
    });
    expect(result.manifest.terminalState).toBeUndefined();
  });

  it("records a CI merge-admission failure as blocked, not action-required", () => {
    const result = run(
      fixture(
        { failMerge: true, mergeWarning: "using signed exact-head evidence" },
        { merge: true, tier: "medium" },
      ),
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.output)).toMatchObject({
      status: "terminal",
      state: "blocked",
    });
    expect(result.manifest.telemetryWrites).toBe(1);
  });

  it("preserves the phase failure when terminal recording also fails", () => {
    const result = run(fixture({ failRisk: true, terminalRecorderFail: true }));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "terminal state recording failed after: risk failed with exit 5",
    );
    expect(result.stderr).not.toContain("Cannot read properties of undefined");
  });
});
