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
 *   - fix-commit count (commits made since the run started)
 *   - wall-clock elapsed since the run started
 *   - repeated-finding-shape detection (same root-cause shape recurring
 *     across rounds, independent of which file it shows up in — see
 *     findingShapeKey), so a run doing N narrow variants of the same fix at
 *     different call sites can be told to batch-fix instead of treating
 *     each as a fresh round
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

function currentCommitCount(cwd) {
  try {
    const out = execFileSync("git", ["rev-list", "--count", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
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
 */
function evaluateBudget(state, { nowEpoch, commitCount }) {
  const requiredFields = [
    "start_epoch",
    "start_commit_count",
    "max_fix_commits",
    "max_wall_seconds",
  ];
  const configInvalid = requiredFields.some(
    (key) => !Number.isFinite(state && state[key]),
  );
  if (configInvalid) {
    return {
      ok: false,
      configInvalid: true,
      elapsedSeconds: null,
      commitsUsed: null,
      maxWallSeconds: state ? state.max_wall_seconds : undefined,
      maxFixCommits: state ? state.max_fix_commits : undefined,
      wallTripped: true,
      commitTripped: true,
    };
  }

  const elapsedSeconds = nowEpoch - state.start_epoch;
  const commitsUsed = commitCount - state.start_commit_count;
  const wallTripped = elapsedSeconds >= state.max_wall_seconds;
  const commitTripped = commitsUsed >= state.max_fix_commits;
  return {
    ok: !wallTripped && !commitTripped,
    configInvalid: false,
    elapsedSeconds,
    commitsUsed,
    maxWallSeconds: state.max_wall_seconds,
    maxFixCommits: state.max_fix_commits,
    wallTripped,
    commitTripped,
  };
}

function main() {
  const [, , cmd, sentinelPath, ...rest] = process.argv;
  if (!cmd || !sentinelPath) {
    process.stderr.write(
      "usage: quality-run-governor.js <check|record-finding|status> <sentinel-path> [args]\n",
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
    let currentFindings;
    try {
      currentFindings = JSON.parse(rest[0] || "[]");
    } catch {
      process.stderr.write(
        `[quality] record-finding: malformed findings JSON argument — treating as empty this round.\n`,
      );
      currentFindings = [];
    }
    const pattern = detectRepeatedPattern(
      state.findings_seen || [],
      currentFindings,
    );
    state.findings_seen = (state.findings_seen || []).concat(currentFindings);
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
      process.stdout.write(
        `[quality] governor sentinel unreadable or missing required fields at ${sentinelPath} — status unavailable.\n`,
      );
      process.exit(1);
    }
    const mins = Math.floor(result.elapsedSeconds / 60);
    const secs = result.elapsedSeconds % 60;
    process.stdout.write(
      `[quality] elapsed ${mins}m${secs}s/${Math.floor(result.maxWallSeconds / 60)}m, ` +
        `fix-commits ${result.commitsUsed}/${result.maxFixCommits}\n`,
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
};

if (require.main === module) {
  main();
}
