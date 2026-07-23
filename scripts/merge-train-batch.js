#!/usr/bin/env node
"use strict";

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

function main() {
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
};
