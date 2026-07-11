#!/usr/bin/env node

/**
 * Quality Run Governor
 *
 * /bs:quality has two nested autonomous loops: the BLOCKING-findings
 * auto-fix loop (Step 2.5, up to 3 attempts) and the Codex re-verification
 * loop (Step 2.6, CODEX_ROUNDS). CODEX_ROUNDS only bounds the inner Codex
 * loop — nothing bounded the OUTER cycle of fix -> re-review across a whole
 * invocation. Two PRs in one night ran 128min/6 commits and 167min/13
 * commits with no circuit breaker (2026-07-03 incident).
 *
 * This module is the run-wide governor every fix/round loop in SKILL.md
 * checks before doing another round of work. It tracks, against a
 * per-invocation JSON sentinel written by Step -1:
 *
 *   - review-round count (panels run since the run started)
 *   - fix-commit count (commits made since the run started)
 *   - wall-clock elapsed since the run started
 *   - repeated-finding-shape detection (same root-cause shape recurring
 *     across rounds, independent of which file it shows up in — see
 *     findingShapeKey), so a run doing N narrow variants of the same fix at
 *     different call sites can be told to batch-fix instead of treating
 *     each as a fresh round
 *
 * WHY THE ROUND COUNTER EXISTS (2026-07-10):
 * The original governor bounded commits and wall-clock but had NO round
 * dimension, and — more importantly — was never called on the review leg. Its
 * three call sites were all downstream of the panel (before a Codex round,
 * mid-Codex-poll, before a fix attempt). The "up to 3 attempts" cap on the
 * outer fix -> re-review cycle existed only as a sentence of English prose in
 * SKILL.md. Since the MODEL orchestrates that loop, an unenforced sentence is
 * not a cap. Consequences:
 *
 *   - 20min elapsed + 0 fix commits => `check` returned ok:true
 *   - a `check` passing at 29:59 could be followed by a 10min review panel and
 *     a 25min Codex poll => ~65min past a nominal "30min cap"
 *
 * `bump-round` is therefore called immediately BEFORE the review panel and
 * fails CLOSED at the cap. The model cannot argue with a non-zero exit code.
 *
 * Pure functions exported for unit testing — see
 *   scripts/__tests__/quality-run-governor.test.js
 */

"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

/**
 * Derive a coarse "shape" key for a finding so near-duplicate findings
 * across rounds (same gap, different call site) collapse to one key.
 *
 * Deliberately FILE-INDEPENDENT: the key is the first significant
 * (digit/punctuation-normalized) words of the summary alone. This is what
 * makes the incident scenario detectable — "on-disk job differs from loaded
 * job" recurring at 4 different call sites (4 different files) must collapse
 * to one shape, or the batch-fix nudge never fires. `file` is used only as a
 * fallback key on the rare finding with an empty/missing summary, normalized
 * (trailing ":N"/":N-M" line-range suffix stripped) purely so that fallback
 * doesn't fragment on line-number churn between rounds.
 *
 * This is a heuristic, not semantic diffing — false merges just mean an
 * extra "is this really the same issue?" glance, not a correctness bug.
 */
function findingShapeKey(finding) {
  // Strip a trailing ":N" or ":N-M" line/range suffix. Split into two
  // anchored, non-nested-quantifier replaces rather than one regex with an
  // optional group after \d+ — equivalent result, but avoids the pattern
  // shape static analyzers flag as a potential ReDoS vector.
  const file = String(finding.file || "")
    .replace(/:\d+-\d+$/, "")
    .replace(/:\d+$/, "");
  const summary = String(finding.summary || finding.title || "")
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[^a-z#\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  return `${summary}`.trim() || file;
}

/**
 * Given the governor state's finding history, decide whether the current
 * round's findings are "narrow variants of the same gap" — i.e. most of
 * them share a shape key already seen in a prior round.
 *
 * @param {Array<{file:string, summary:string}>} priorFindings flat history
 * @param {Array<{file:string, summary:string}>} currentFindings this round
 * @param {number} threshold fraction (0-1) of current findings that must
 *   repeat a prior shape to count as a repeated-pattern round. Default 0.6.
 */
function detectRepeatedPattern(
  priorFindings,
  currentFindings,
  threshold = 0.6,
) {
  if (!currentFindings.length) {
    return { repeated: false, shape: null, matchCount: 0, total: 0 };
  }
  const priorShapes = new Map();
  for (const f of priorFindings) {
    const key = findingShapeKey(f);
    priorShapes.set(key, (priorShapes.get(key) || 0) + 1);
  }
  const shapeCounts = new Map();
  for (const f of currentFindings) {
    const key = findingShapeKey(f);
    shapeCounts.set(key, (shapeCounts.get(key) || 0) + 1);
  }
  // Find the dominant shape in the current round that also appeared before.
  let bestShape = null;
  let bestCount = 0;
  for (const [key, count] of shapeCounts) {
    if (priorShapes.has(key) && count > bestCount) {
      bestShape = key;
      bestCount = count;
    }
  }
  const matchCount = bestShape ? bestCount : 0;
  const repeated =
    matchCount / currentFindings.length >= threshold && matchCount >= 2;
  return {
    repeated,
    shape: bestShape,
    matchCount,
    total: currentFindings.length,
  };
}

/**
 * Return the current commit count on HEAD, or `null` on any git failure
 * (detached-HEAD race, transient lock, wrong cwd). MUST NOT return `0` on
 * failure: `0` is indistinguishable from a genuinely empty repo, and
 * `evaluateBudget` computes `commitsUsed = commitCount - start_commit_count`
 * — a failure-as-`0` on a repo already at commit 5 produces a large
 * *negative* `commitsUsed`, which can never trip the commit-cap circuit
 * breaker. That silently disables the commit dimension of a fail-closed
 * guardrail exactly when git is unreliable — the opposite of the intended
 * behavior. Returning `null` lets `evaluateBudget` fail CLOSED via the same
 * `Number.isFinite` check it already applies to the sentinel's own fields.
 */
function currentCommitCount(cwd) {
  try {
    const out = execFileSync("git", ["rev-list", "--count", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = parseInt(out.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Load the governor sentinel. Returns `null` on any read/parse failure
 * (missing file, truncated write, corrupt JSON) instead of throwing —
 * callers treat `null` as "state unreadable" and fail CLOSED (the sentinel
 * existing but being unreadable is itself a signal something is wrong with
 * the run, so the safe default is to halt, not to silently pass).
 */
function loadState(sentinelPath) {
  try {
    const raw = fs.readFileSync(sentinelPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(sentinelPath, state) {
  fs.writeFileSync(sentinelPath, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Parse the `record-finding` CLI arg into an array of {file, summary}
 * findings, always returning an array — never throwing, never passing a
 * non-array through to callers that assume array shape (detectRepeatedPattern
 * and the findings_seen .concat()).
 *
 * JSON.parse happily accepts valid-but-non-array JSON ("42", "\"x\"", "{}"),
 * which would otherwise either throw when iterated as an array or silently
 * corrupt findings_seen by appending a scalar/object as a single "finding".
 * Both the malformed-JSON case and the valid-but-wrong-shape case log to
 * stderr and degrade to an empty array — same fail-safe behavior, one
 * function, so `main()`'s record-finding branch stays flat.
 */
function parseFindingsArg(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    process.stderr.write(
      `[quality] record-finding: malformed findings JSON argument — treating as empty this round.\n`,
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    process.stderr.write(
      `[quality] record-finding: findings JSON argument was valid JSON but not an array — treating as empty this round.\n`,
    );
    return [];
  }
  return parsed;
}

/**
 * Extract a safe findings array from the LOADED sentinel state's
 * `findings_seen` field. `state.findings_seen || []` only substitutes on
 * falsy (undefined/null/""), so a truthy-but-non-array value surviving in the
 * sentinel (a partial/corrupt write, or manual tampering) would flow straight
 * into `.concat()`. `Array.prototype.concat` called on a non-array `this`
 * coerces through `String.prototype.concat` and silently corrupts
 * `findings_seen` into a string, which re-corrupts every subsequent round and
 * silently disables repeated-pattern detection for the rest of the run with
 * no warning — verified: `findings_seen: "corrupted"` + one finding becomes a
 * garbage string with exit code 0. Coerce to `[]` here exactly as
 * `parseFindingsArg` does for the CLI arg, so the sentinel's own history
 * can't carry this failure mode.
 */
function priorFindingsFrom(state) {
  return Array.isArray(state && state.findings_seen) ? state.findings_seen : [];
}

/**
 * Evaluate whether the run may continue. Returns a plain object (never
 * throws on a tripped budget — that's a normal, expected outcome, not an
 * error) so the caller can render it and decide whether to exit.
 *
 * Fail-closed on malformed state: a circuit breaker's entire job is to stop
 * a runaway loop, so a sentinel with a missing/non-numeric bound must trip
 * the budget rather than silently disable it (`x >= undefined` and
 * `x >= NaN` both evaluate to `false` in JS, which is the wrong default
 * here). `configInvalid` distinguishes this case from a genuine trip so
 * callers can surface a distinct diagnostic.
 *
 * Also fails closed when `commitCount` itself is non-finite (i.e. git
 * failed — see `currentCommitCount`'s `null` return). Treating a failed
 * commit-count read as "0 commits" would make `commitsUsed` go negative
 * and never trip; treating it as invalid config instead halts the run,
 * consistent with every other "the breaker's own inputs are untrustworthy"
 * case here.
 */
function evaluateBudget(state, { nowEpoch, commitCount }) {
  const requiredFields = [
    "start_epoch",
    "start_commit_count",
    "max_fix_commits",
    "max_wall_seconds",
    "max_review_rounds",
  ];
  const configInvalid =
    requiredFields.some((key) => !Number.isFinite(state && state[key])) ||
    !Number.isFinite(commitCount);
  if (configInvalid) {
    return {
      ok: false,
      configInvalid: true,
      elapsedSeconds: null,
      commitsUsed: null,
      roundsUsed: null,
      maxWallSeconds: state ? state.max_wall_seconds : undefined,
      maxFixCommits: state ? state.max_fix_commits : undefined,
      maxReviewRounds: state ? state.max_review_rounds : undefined,
      wallTripped: true,
      commitTripped: true,
      roundTripped: true,
    };
  }

  const elapsedSeconds = nowEpoch - state.start_epoch;
  const commitsUsed = commitCount - state.start_commit_count;
  // rounds_used is absent on a sentinel written before this field existed;
  // treat as 0 rather than tripping configInvalid, so an in-flight run that
  // straddles an upgrade degrades to "no rounds consumed yet" instead of
  // halting. Every NEW sentinel writes it explicitly (see SKILL.md Step -1).
  const roundsUsed = Number.isFinite(state.rounds_used) ? state.rounds_used : 0;
  const wallTripped = elapsedSeconds >= state.max_wall_seconds;
  const commitTripped = commitsUsed >= state.max_fix_commits;
  // `rounds_used` is incremented BEFORE evaluation (bump-round), so it is the
  // 1-based index of the round about to run. A cap of 2 must therefore permit
  // rounds 1 and 2 and refuse round 3 — i.e. strictly-greater-than, not >=.
  // (`>=` here would allow only max-1 rounds: a cap of 2 blocked round 2.)
  const roundTripped = roundsUsed > state.max_review_rounds;
  return {
    ok: !wallTripped && !commitTripped && !roundTripped,
    configInvalid: false,
    elapsedSeconds,
    commitsUsed,
    roundsUsed,
    maxWallSeconds: state.max_wall_seconds,
    maxFixCommits: state.max_fix_commits,
    maxReviewRounds: state.max_review_rounds,
    wallTripped,
    commitTripped,
    roundTripped,
  };
}

/**
 * `bump-round` — called IMMEDIATELY BEFORE the review panel runs (SKILL.md
 * Step 2.0). Increments rounds_used, persists, then evaluates every budget.
 * Returns the process exit code: 0 to proceed, 1 to halt.
 *
 * This is THE enforcement point for the outer fix -> re-review loop. Before it
 * existed, that loop's only bound was a sentence of prose in SKILL.md, and the
 * model — which orchestrates the loop — could and did run past it (128min and
 * 167min runs, 2026-07-03). Returning a non-zero exit code is the whole point:
 * a shell `|| exit 1` is not something the model can talk itself out of.
 *
 * Fails CLOSED on an unreadable or incomplete sentinel: a circuit breaker that
 * silently disables itself when its own state is untrustworthy is worse than
 * no breaker, because it reads as protection that isn't there.
 */
function bumpRound(sentinelPath, cwd) {
  const state = loadState(sentinelPath);
  if (!state) {
    process.stderr.write(
      `[quality] governor sentinel unreadable at ${sentinelPath} — failing CLOSED. The review loop cannot be bounded without it, and an unbounded loop is the exact failure this governor exists to prevent.\n`,
    );
    return 1;
  }

  const priorRounds = Number.isFinite(state.rounds_used)
    ? state.rounds_used
    : 0;
  state.rounds_used = priorRounds + 1;
  saveState(sentinelPath, state);

  const result = evaluateBudget(state, {
    nowEpoch: Math.floor(Date.now() / 1000),
    commitCount: currentCommitCount(cwd),
  });

  if (result.configInvalid) {
    process.stderr.write(
      `[quality] governor sentinel missing required fields at ${sentinelPath} — failing CLOSED (halting), not silently passing.\n`,
    );
    return 1;
  }

  if (result.roundTripped) {
    process.stderr.write(
      `[quality] ROUND BUDGET EXHAUSTED: review round ${result.roundsUsed} would exceed the cap of ${result.maxReviewRounds}.\n` +
        `[quality] Stopping the fix -> re-review loop. Report the outstanding findings and STOP — do not run another panel.\n` +
        `[quality] Override deliberately with BS_QUALITY_MAX_REVIEW_ROUNDS if a repo genuinely needs more.\n`,
    );
    return 1;
  }

  if (!result.ok) {
    const wall = result.wallTripped
      ? `wall-clock ${result.elapsedSeconds}s >= ${result.maxWallSeconds}s `
      : "";
    const commits = result.commitTripped
      ? `fix-commits ${result.commitsUsed} >= ${result.maxFixCommits}`
      : "";
    process.stderr.write(
      `[quality] BUDGET EXHAUSTED before review round ${result.roundsUsed}: ${wall}${commits}\n` +
        `[quality] Stopping. Report outstanding findings and STOP.\n`,
    );
    return 1;
  }

  process.stdout.write(
    `[quality] review round ${result.roundsUsed}/${result.maxReviewRounds} ` +
      `(elapsed ${result.elapsedSeconds}s/${result.maxWallSeconds}s, ` +
      `fix-commits ${result.commitsUsed}/${result.maxFixCommits})\n`,
  );
  return 0;
}

function main() {
  const [, , cmd, sentinelPath, ...rest] = process.argv;
  if (!cmd || !sentinelPath) {
    process.stderr.write(
      "usage: quality-run-governor.js <check|bump-round|record-finding|status> <sentinel-path> [args]\n",
    );
    process.exit(2);
  }

  const cwd = process.env.QUALITY_CWD || process.cwd();

  if (cmd === "check") {
    const state = loadState(sentinelPath);
    const result = evaluateBudget(state, {
      nowEpoch: Math.floor(Date.now() / 1000),
      commitCount: currentCommitCount(cwd),
    });
    if (result.configInvalid) {
      process.stderr.write(
        `[quality] governor sentinel unreadable or missing required fields at ${sentinelPath} — failing CLOSED (halting), not silently passing.\n`,
      );
    }
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(result.ok ? 0 : 1);
  }

  if (cmd === "bump-round") {
    process.exit(bumpRound(sentinelPath, cwd));
  }

  if (cmd === "record-finding") {
    // rest = JSON array of {file, summary} for this round's findings, as a
    // single JSON string argument.
    const state = loadState(sentinelPath);
    if (!state) {
      process.stderr.write(
        `[quality] governor sentinel unreadable at ${sentinelPath} — cannot record findings this round (repeated-pattern detection disabled for this round).\n`,
      );
      process.stdout.write(
        JSON.stringify({
          repeated: false,
          shape: null,
          matchCount: 0,
          total: 0,
        }) + "\n",
      );
      process.exit(1);
    }
    const currentFindings = parseFindingsArg(rest[0]);
    const priorFindings = priorFindingsFrom(state);
    const pattern = detectRepeatedPattern(priorFindings, currentFindings);
    state.findings_seen = priorFindings.concat(currentFindings);
    saveState(sentinelPath, state);
    process.stdout.write(JSON.stringify(pattern) + "\n");
    process.exit(0);
  }

  if (cmd === "status") {
    const state = loadState(sentinelPath);
    const result = evaluateBudget(state, {
      nowEpoch: Math.floor(Date.now() / 1000),
      commitCount: currentCommitCount(cwd),
    });
    if (result.configInvalid) {
      process.stderr.write(
        `[quality] governor sentinel unreadable or missing required fields at ${sentinelPath} — status unavailable.\n`,
      );
      process.exit(1);
    }
    const mins = Math.floor(result.elapsedSeconds / 60);
    const secs = result.elapsedSeconds % 60;
    process.stdout.write(
      `[quality] elapsed ${mins}m${secs}s/${Math.floor(result.maxWallSeconds / 60)}m, ` +
        `fix-commits ${result.commitsUsed}/${result.maxFixCommits}, ` +
        `review-rounds ${result.roundsUsed}/${result.maxReviewRounds}\n`,
    );
    process.exit(0);
  }

  process.stderr.write(`unknown command: ${cmd}\n`);
  process.exit(2);
}

module.exports = {
  findingShapeKey,
  detectRepeatedPattern,
  evaluateBudget,
  bumpRound,
  parseFindingsArg,
  priorFindingsFrom,
};

if (require.main === module) {
  main();
}
