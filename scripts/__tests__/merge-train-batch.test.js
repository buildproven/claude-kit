const {
  reconcilePr,
  reconcileRebasedPr,
  remainingBudget,
  planPanel,
  planBatch,
  reserveAdmission,
} = require("../merge-train-batch");
const { spawn, spawnSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { makeTempDir } = require("./helpers/tmp.js");

const sha = (character) => character.repeat(40);

function admit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve(__dirname, "..", "merge-train-batch.js"),
      "admit",
      ...args,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("merge-train batch controller", () => {
  it("requires a fresh exact-HEAD review when either the PR code or base moved", () => {
    expect(
      reconcilePr(
        { number: 42, headSha: sha("a"), baseSha: sha("b") },
        { number: 42, headSha: sha("a"), baseSha: sha("c") },
      ),
    ).toMatchObject({
      changed: { head: false, base: true },
      requiresFreshReview: true,
    });
    expect(
      reconcilePr(
        { number: 42, headSha: sha("a"), baseSha: sha("b") },
        { number: 42, headSha: sha("c"), baseSha: sha("b") },
      ),
    ).toMatchObject({
      changed: { head: true, base: false },
      requiresFreshReview: true,
    });
  });

  it("carries only a provably identical patch across a same-repository rebase", () => {
    const reviewed = {
      number: 42,
      headSha: sha("a"),
      baseSha: sha("b"),
    };
    expect(
      reconcileRebasedPr(reviewed, {
        number: 42,
        headSha: sha("c"),
        baseSha: sha("d"),
        reviewedPatchId: sha("e"),
        currentPatchId: sha("e"),
      }),
    ).toMatchObject({
      changed: { head: true, base: true },
      rebaseOnly: true,
      requiresFreshReview: false,
    });
    expect(
      reconcileRebasedPr(reviewed, {
        number: 42,
        headSha: sha("c"),
        baseSha: sha("d"),
        reviewedPatchId: sha("e"),
        currentPatchId: sha("f"),
      }),
    ).toMatchObject({ rebaseOnly: false, requiresFreshReview: true });
  });

  it("exposes rebase carry through its stdin controller contract", () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "..", "merge-train-batch.js")],
      {
        encoding: "utf8",
        input: JSON.stringify({
          mode: "rebase-carry",
          reviewed: { number: 42, headSha: sha("a"), baseSha: sha("b") },
          rebased: {
            number: 42,
            headSha: sha("c"),
            baseSha: sha("d"),
            reviewedPatchId: sha("e"),
            currentPatchId: sha("e"),
          },
        }),
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      rebaseOnly: true,
      requiresFreshReview: false,
    });
  });

  it("shares one batch clock instead of granting every PR a new campaign budget", () => {
    const plan = planBatch({
      startedAtEpoch: 1_000,
      budgetSeconds: 600,
      nowEpoch: 1_100,
      candidates: [
        {
          discovered: { number: 1, headSha: sha("a"), baseSha: sha("b") },
          current: { number: 1, headSha: sha("a"), baseSha: sha("b") },
          tier: "high",
          fullAgents: 4,
          reviewSeconds: 300,
        },
        {
          discovered: { number: 2, headSha: sha("c"), baseSha: sha("b") },
          current: { number: 2, headSha: sha("c"), baseSha: sha("b") },
          tier: "high",
          fullAgents: 4,
          reviewSeconds: 300,
        },
      ],
    });
    expect(plan.candidates[0].panel).toMatchObject({
      action: "start",
      incomplete: false,
    });
    expect(plan.candidates[1].panel).toMatchObject({
      action: "start",
      incomplete: true,
      selectedAgents: 2,
    });
    expect(plan.remainingSeconds).toBe(50);
    expect(
      remainingBudget({ startedAtEpoch: 1_000, budgetSeconds: 600 }, 1_100),
    ).toBe(500);
  });

  it("refuses a critical panel that cannot finish its full planned review", () => {
    expect(
      planPanel({
        tier: "critical",
        fullAgents: 6,
        reviewSeconds: 540,
        remainingSeconds: 539,
      }),
    ).toMatchObject({
      action: "defer",
      reason: "critical-panel-cannot-finish-within-batch-budget",
      minimumSeconds: 540,
    });
  });

  it("makes a deliberate reduced panel visible instead of pretending it was full", () => {
    expect(
      planPanel({
        tier: "high",
        fullAgents: 5,
        reviewSeconds: 300,
        remainingSeconds: 190,
      }),
    ).toMatchObject({
      action: "start",
      reason: "reduced-panel-fits-batch-budget",
      selectedAgents: 3,
      fullAgents: 5,
      reservedSeconds: 180,
      incomplete: true,
    });
  });

  it("atomically models a shared reservation as a one-time admission", () => {
    const request = {
      deadlineEpoch: 2_000,
      budgetSeconds: 300,
      nowEpoch: 1_500,
      reservationId: "buildproven/kit#42",
      reservedSeconds: 180,
    };
    const initial = {
      schemaVersion: 1,
      deadlineEpoch: request.deadlineEpoch,
      budgetSeconds: request.budgetSeconds,
      reservations: {},
    };
    const first = reserveAdmission(initial, request);
    expect(first).toMatchObject({
      admitted: true,
      reused: false,
      remainingSeconds: 120,
    });
    expect(first.state).not.toBe(initial);
    expect(first.state.reservations).not.toBe(initial.reservations);
    expect(initial.reservations).toEqual({});
    const retry = reserveAdmission(first.state, request);
    expect(retry).toMatchObject({
      admitted: true,
      reused: true,
      remainingSeconds: 120,
    });
    expect(
      reserveAdmission(first.state, {
        ...request,
        reservationId: "buildproven/setup#11",
        reservedSeconds: 121,
      }),
    ).toMatchObject({ admitted: false, reason: "shared-budget-reserved" });
  });

  it("rejects a retry with a different budget for the same reservation id instead of throwing", () => {
    const request = {
      deadlineEpoch: 2_000,
      budgetSeconds: 300,
      nowEpoch: 1_500,
      reservationId: "buildproven/kit#42",
      reservedSeconds: 180,
    };
    const first = reserveAdmission(null, request);
    const retry = reserveAdmission(first.state, {
      ...request,
      reservedSeconds: 90,
    });
    expect(retry).toMatchObject({
      admitted: false,
      reason: "reservation-mismatch",
      remainingSeconds: 120,
    });
    expect(retry.state.reservations["buildproven/kit#42"]).toMatchObject({
      reservedSeconds: 180,
    });
  });

  it("stops new admissions at the common deadline without revoking a lease", () => {
    const result = reserveAdmission(
      {
        schemaVersion: 1,
        deadlineEpoch: 2_000,
        budgetSeconds: 300,
        reservations: { "buildproven/kit#42": { reservedSeconds: 180 } },
      },
      {
        deadlineEpoch: 2_000,
        budgetSeconds: 300,
        nowEpoch: 2_000,
        reservationId: "buildproven/setup#11",
        reservedSeconds: 60,
      },
    );
    expect(result).toMatchObject({
      admitted: false,
      reason: "shared-deadline-exhausted",
      remainingSeconds: 120,
    });
    expect(result.state.reservations["buildproven/kit#42"]).toMatchObject({
      reservedSeconds: 180,
    });
  });

  it("serializes simultaneous worker admissions through the shared ledger", async () => {
    const stateFile = path.join(makeTempDir("merge-train-"), "state.json");
    const shared = [
      "--state-file",
      stateFile,
      "--deadline-epoch",
      String(Math.floor(Date.now() / 1000) + 60),
      "--budget-seconds",
      "300",
      "--reserved-seconds",
      "180",
    ];
    const [first, second] = await Promise.all([
      admit([...shared, "--reservation-id", "buildproven/kit#42"]),
      admit([...shared, "--reservation-id", "buildproven/setup#11"]),
    ]);
    expect([first.status, second.status].sort()).toEqual([0, 2]);
    const admitted = [first, second].find((result) => result.status === 0);
    expect(JSON.parse(admitted.stdout)).toMatchObject({
      admitted: true,
      remainingSeconds: 120,
    });
  });

  it("fails with a descriptive error instead of an uncaught exception on a corrupted state file", async () => {
    const stateFile = path.join(makeTempDir("merge-train-"), "state.json");
    writeFileSync(stateFile, "{not valid json");
    const result = await admit([
      "--state-file",
      stateFile,
      "--deadline-epoch",
      String(Math.floor(Date.now() / 1000) + 60),
      "--budget-seconds",
      "300",
      "--reserved-seconds",
      "180",
      "--reservation-id",
      "buildproven/kit#42",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not valid JSON/);
  });

  it("reclaims an admission lock abandoned by a dead process instead of wedging forever", async () => {
    const stateFile = path.join(makeTempDir("merge-train-"), "state.json");
    const lockDirectory = `${stateFile}.lock`;
    mkdirSync(lockDirectory, { mode: 0o700 });
    writeFileSync(
      path.join(lockDirectory, "owner.json"),
      JSON.stringify({ pid: 999_999, acquiredAtEpoch: Date.now() }),
    );
    const result = await admit([
      "--state-file",
      stateFile,
      "--deadline-epoch",
      String(Math.floor(Date.now() / 1000) + 60),
      "--budget-seconds",
      "300",
      "--reserved-seconds",
      "180",
      "--reservation-id",
      "buildproven/kit#42",
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ admitted: true });
  });
});
