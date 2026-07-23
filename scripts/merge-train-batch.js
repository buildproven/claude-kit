#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Deterministic admission planning for a merge-train batch.
 *
 * A quality campaign has its own bounded clock, but a train is an aggregate
 * operation. This module makes the aggregate reservation explicit before a
 * worker can start an expensive gate or provider panel. It deliberately has
 * no git/GitHub side effects: the merge-train controller supplies the
 * freshly-fetched PR snapshots and performs the reconciliation itself.
 */

const MIN_PANEL_AGENTS = 2;

function integer(value, name, { minimum = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function prSnapshot(snapshot, name) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`${name} PR snapshot is required`);
  }
  const number = integer(snapshot.number, `${name}.number`, { minimum: 1 });
  for (const field of ["headSha", "baseSha"]) {
    if (typeof snapshot[field] !== "string" || snapshot[field].length < 7) {
      throw new Error(`${name}.${field} must be a commit SHA`);
    }
  }
  return { number, headSha: snapshot.headSha, baseSha: snapshot.baseSha };
}

/**
 * Compare the snapshot captured at discovery with the snapshot captured after
 * the worker fetched both refs. Any code or base movement invalidates prior
 * evidence; the caller must create a new exact-HEAD campaign from `current`.
 */
function reconcilePr(discovered, current) {
  const before = prSnapshot(discovered, "discovered");
  const after = prSnapshot(current, "current");
  if (before.number !== after.number) {
    throw new Error("discovered and current snapshots name different PRs");
  }
  const changed = {
    head: before.headSha !== after.headSha,
    base: before.baseSha !== after.baseSha,
  };
  return {
    ...after,
    changed,
    requiresFreshReview: changed.head || changed.base,
  };
}

function remainingBudget({ startedAtEpoch, budgetSeconds }, nowEpoch) {
  const started = integer(startedAtEpoch, "startedAtEpoch", { minimum: 0 });
  const budget = integer(budgetSeconds, "budgetSeconds", { minimum: 1 });
  const now = integer(nowEpoch, "nowEpoch", { minimum: started });
  return Math.max(0, budget - (now - started));
}

/**
 * Decide the largest panel that can finish within the already-shared batch
 * budget. A partial panel is explicit and remains incomplete evidence; it is
 * never silently treated as the mandatory panel.
 */
function planPanel({ tier, fullAgents, reviewSeconds, remainingSeconds }) {
  if (!["low", "medium", "high", "critical"].includes(tier)) {
    throw new Error("tier must be low, medium, high, or critical");
  }
  const agents = integer(fullAgents, "fullAgents", {
    minimum: MIN_PANEL_AGENTS,
  });
  const fullSeconds = integer(reviewSeconds, "reviewSeconds", { minimum: 1 });
  const remaining = integer(remainingSeconds, "remainingSeconds", {
    minimum: 0,
  });
  const minimumSeconds = Math.ceil((fullSeconds * MIN_PANEL_AGENTS) / agents);

  // Critical is a veto tier, not a cost-reduction tier. BUI-399's explicit
  // incomplete-panel path is available to non-critical work only; a critical
  // panel that cannot finish its full planned pass must remain deferred.
  if (tier === "critical" && remaining < fullSeconds) {
    return {
      action: "defer",
      reason: "critical-panel-cannot-finish-within-batch-budget",
      selectedAgents: 0,
      fullAgents: agents,
      reservedSeconds: 0,
      minimumSeconds: fullSeconds,
      incomplete: false,
    };
  }
  if (remaining < minimumSeconds) {
    return {
      action: "defer",
      reason: "minimum-panel-cannot-finish-within-batch-budget",
      selectedAgents: 0,
      fullAgents: agents,
      reservedSeconds: 0,
      minimumSeconds,
      incomplete: false,
    };
  }
  if (remaining >= fullSeconds) {
    return {
      action: "start",
      reason: "full-panel-fits-batch-budget",
      selectedAgents: agents,
      fullAgents: agents,
      reservedSeconds: fullSeconds,
      minimumSeconds,
      incomplete: false,
    };
  }

  const selectedAgents = Math.max(
    MIN_PANEL_AGENTS,
    Math.min(agents - 1, Math.floor((agents * remaining) / fullSeconds)),
  );
  const reservedSeconds = Math.ceil((fullSeconds * selectedAgents) / agents);
  return {
    action: "start",
    reason: "reduced-panel-fits-batch-budget",
    selectedAgents,
    fullAgents: agents,
    reservedSeconds,
    minimumSeconds,
    incomplete: true,
  };
}

/**
 * Coalesce ready PRs in input order under one wall-clock budget. The output is
 * intentionally a plan, not an execution result: the controller must fetch
 * and reconcile each item before honoring its reservation.
 */
function planBatch({ startedAtEpoch, budgetSeconds, nowEpoch, candidates }) {
  if (!Array.isArray(candidates))
    throw new Error("candidates must be an array");
  let remaining = remainingBudget({ startedAtEpoch, budgetSeconds }, nowEpoch);
  const planned = candidates.map((candidate) => {
    const reconciliation = reconcilePr(candidate.discovered, candidate.current);
    const panel = planPanel({ ...candidate, remainingSeconds: remaining });
    const result = {
      pr: reconciliation.number,
      reconciliation,
      batchRemainingBeforeSeconds: remaining,
      panel,
      batchRemainingAfterSeconds: remaining - panel.reservedSeconds,
    };
    remaining = result.batchRemainingAfterSeconds;
    return result;
  });
  return { remainingSeconds: remaining, candidates: planned };
}

function reservationId(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 512) {
    throw new Error(
      "reservationId must be a non-empty string up to 512 characters",
    );
  }
  return value;
}

/**
 * Apply one merge-train reservation to a durable admission ledger. This is
 * deliberately separate from `planBatch`: plans are advisory snapshots,
 * while every worker must make this state transition under the file lock
 * below before it can launch a quality campaign.
 *
 * A granted reservation is not revoked at the wall-clock deadline. BUI-348
 * makes that an important semantic boundary: the shared budget constrains new
 * work, not an already useful provider pass in flight.
 */
function reserveAdmission(state, request) {
  const deadlineEpoch = integer(request.deadlineEpoch, "deadlineEpoch", {
    minimum: 1,
  });
  const budgetSeconds = integer(request.budgetSeconds, "budgetSeconds", {
    minimum: 1,
  });
  const nowEpoch = integer(request.nowEpoch, "nowEpoch", { minimum: 0 });
  const id = reservationId(request.reservationId);
  const reservedSeconds = integer(request.reservedSeconds, "reservedSeconds", {
    minimum: 1,
  });
  const current = state || {
    schemaVersion: 1,
    deadlineEpoch,
    budgetSeconds,
    reservations: {},
  };
  if (
    current.schemaVersion !== 1 ||
    current.deadlineEpoch !== deadlineEpoch ||
    current.budgetSeconds !== budgetSeconds ||
    !current.reservations ||
    typeof current.reservations !== "object" ||
    Array.isArray(current.reservations)
  ) {
    throw new Error("merge-train admission state does not match this sweep");
  }
  const existing = current.reservations[id];
  if (existing) {
    if (existing.reservedSeconds !== reservedSeconds) {
      throw new Error(
        "reservation id was already admitted with a different budget",
      );
    }
    return {
      state: current,
      admitted: true,
      reused: true,
      reservation: existing,
      remainingSeconds: budgetSeconds - reservedTotal(current),
    };
  }
  if (nowEpoch >= deadlineEpoch) {
    return {
      state: current,
      admitted: false,
      reason: "shared-deadline-exhausted",
      remainingSeconds: budgetSeconds - reservedTotal(current),
    };
  }
  const used = reservedTotal(current);
  if (used + reservedSeconds > budgetSeconds) {
    return {
      state: current,
      admitted: false,
      reason: "shared-budget-reserved",
      remainingSeconds: budgetSeconds - used,
    };
  }
  const reservation = {
    reservedSeconds,
    admittedAtEpoch: nowEpoch,
  };
  current.reservations[id] = reservation;
  return {
    state: current,
    admitted: true,
    reused: false,
    reservation,
    remainingSeconds: budgetSeconds - reservedTotal(current),
  };
}

function reservedTotal(state) {
  return Object.values(state.reservations || {}).reduce(
    (total, reservation) => {
      return (
        total +
        integer(reservation.reservedSeconds, "reservation.reservedSeconds", {
          minimum: 1,
        })
      );
    },
    0,
  );
}

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withAdmissionLock(stateFile, callback) {
  const resolved = path.resolve(stateFile);
  const directory = path.dirname(resolved);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockDirectory = `${resolved}.lock`;
  const expiresAt = Date.now() + 10_000;
  for (;;) {
    try {
      fs.mkdirSync(lockDirectory, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= expiresAt) {
        throw new Error("timed out waiting for merge-train admission lock", {
          cause: error,
        });
      }
      pause(25);
    }
  }
  try {
    const current = fs.existsSync(resolved)
      ? JSON.parse(fs.readFileSync(resolved, "utf8"))
      : null;
    const result = callback(current);
    const temporary = path.join(
      directory,
      `.${path.basename(resolved)}.${process.pid}.${Date.now()}.tmp`,
    );
    fs.writeFileSync(temporary, `${JSON.stringify(result.state, null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, 0o600);
    return result;
  } finally {
    fs.rmdirSync(lockDirectory);
  }
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return args[index + 1];
}

function admit(args) {
  const stateFile = readOption(args, "--state-file");
  const request = {
    deadlineEpoch: readOption(args, "--deadline-epoch"),
    budgetSeconds: readOption(args, "--budget-seconds"),
    reservationId: readOption(args, "--reservation-id"),
    reservedSeconds: readOption(args, "--reserved-seconds"),
    nowEpoch: Math.floor(Date.now() / 1000),
  };
  const result = withAdmissionLock(stateFile, (state) =>
    reserveAdmission(state, request),
  );
  const output = {
    admitted: result.admitted,
    reused: result.reused || false,
    reason: result.reason || null,
    remainingSeconds: result.remainingSeconds,
  };
  if (result.admitted) {
    output.environment = {
      BS_QUALITY_SHARED_DEADLINE_EPOCH: String(request.deadlineEpoch),
      BS_QUALITY_TRAIN_RESERVATION_SECONDS: String(request.reservedSeconds),
      BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS: String(request.reservedSeconds),
    };
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return result.admitted ? 0 : 2;
}

function main() {
  if (process.argv[2] === "admit") {
    process.exitCode = admit(process.argv.slice(3));
    return;
  }
  let input;
  try {
    input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  } catch {
    throw new Error("expected one JSON batch plan on stdin");
  }
  process.stdout.write(`${JSON.stringify(planBatch(input), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`merge-train-batch: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MIN_PANEL_AGENTS,
  reconcilePr,
  remainingBudget,
  planPanel,
  planBatch,
  reserveAdmission,
  reservedTotal,
};
