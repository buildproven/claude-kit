#!/usr/bin/env node

/**
 * Quality Telemetry Recorder
 *
 * Wave 2.5 of the SOTA quality upgrade (BUI-341). The quality system was
 * open-loop: it ran, but nothing measured whether it was worth its tokens.
 * This module closes the loop by appending ONE JSON line per finished campaign
 * to a telemetry log, from which a weekly report derives escaped-defect rate,
 * finding precision, and cost per caught bug.
 *
 * Every field recorded already exists in the invocation manifest — the single
 * source of campaign truth (see quality-invocation.js createManifest). We do
 * not re-derive anything the manifest already knows; we summarize it.
 *
 * DESTINATION (kit stays standalone — see core/CLAUDE.md "this repo never
 * embeds references to anything that overlays it"): the log path resolves to
 *   1. $BS_QUALITY_TELEMETRY_FILE if set (an overlay can pin a committed path)
 *   2. else $XDG_STATE_HOME/claude-kit/quality-telemetry/<repo-key>.jsonl
 *      (falling back to ~/.local/state)
 * The default is deliberately outside the target repo: auditing a clean
 * worktree must leave it clean. Committed, fleet-visible history remains
 * opt-in via $BS_QUALITY_TELEMETRY_FILE.
 *
 * IDEMPOTENT: keyed on invocationId. A campaign that records twice (a merge
 * path plus a terminal-report path, or a resumed run) appends exactly once.
 * Absence of a manifest, or an unreadable one, is a hard failure — telemetry
 * that silently no-ops would report "quality is cheap" by recording nothing.
 * But a telemetry WRITE failure must NOT fail the campaign: measuring the run
 * is strictly less important than the run's own verdict. `record` therefore
 * exits 0 on a successful append or a benign duplicate, and exits 0 with a
 * stderr warning if the log is unwritable — never blocks a merge.
 *
 * Pure summary functions are exported for unit testing — see
 *   scripts/__tests__/quality-telemetry.test.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const TELEMETRY_SCHEMA_VERSION = 2;

/**
 * Read a finished invocation manifest for summarization.
 *
 * Deliberately NOT quality-invocation.loadManifest: that enforces the live
 * tmp-root/stateRoot identity contract used while a campaign mutates state.
 * Telemetry runs at the terminal step and only needs the manifest's recorded
 * facts, not proof it still owns the tmp sentinel — reusing the strict loader
 * would couple observational recording to that contract and reject a manifest
 * copied or relocated for reporting. We validate only what we summarize.
 */
function readManifest(manifestPath) {
  const resolved = path.resolve(manifestPath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    throw new Error("quality manifest must not be a symlink");
  }
  const raw = fs.readFileSync(resolved, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`quality manifest is not valid JSON: ${error.message}`, {
      cause: error,
    });
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `unsupported quality manifest schema ${manifest.schemaVersion}`,
    );
  }
  if (!manifest.invocationId || !manifest.repo?.realpath) {
    throw new Error("quality manifest is missing required identity fields");
  }
  return manifest;
}

/**
 * Resolve where telemetry lines are appended. Env override wins so an overlay
 * (or CI) can pin a single committed path; otherwise an operator-state
 * directory keeps the audited repository byte-for-byte clean.
 */
function resolveTelemetryFile(manifest) {
  const override = process.env.BS_QUALITY_TELEMETRY_FILE;
  if (override && override.trim()) {
    return path.resolve(override.trim());
  }
  const stateHome =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(
    stateHome,
    "claude-kit",
    "quality-telemetry",
    `${manifest.repo.key}.jsonl`,
  );
}

/**
 * Number of successful review rounds actually run this campaign. `reviews` is
 * the authoritative record; governor.roundsUsed can lag a crash mid-round, so
 * count successes directly (matches how judge derives reviewCount).
 */
function successfulReviewCount(manifest) {
  if (!Array.isArray(manifest.reviews)) return 0;
  return manifest.reviews.filter((review) => review.status === "success")
    .length;
}

/**
 * Files this campaign's review covered — the change set under
 * baseSha..currentHead. Recorded so the escaped-defect tagger can later ask
 * "did a later fix: commit touch a file a passed campaign already reviewed?"
 * without re-running git against a possibly-rebased history. Returns [] when
 * the range can't be computed (fail-soft: telemetry is never load-bearing).
 */
function coveredFiles(manifest, execFileSync) {
  const base = manifest.revisions?.baseSha;
  const head = manifest.revisions?.currentHead;
  if (!base || !head) return [];
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", `${base}..${head}`],
      {
        cwd: manifest.repo.realpath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Derive the campaign verdict from persisted state alone — no model judgment.
 *
 *  - "authorized"   : merge requested and the judge cleared it (0 blocking).
 *                     This is "authorized to merge", NOT "merged" — the actual
 *                     GitHub merge is async/CI-owned and can still abort after
 *                     the judge clears (red CI, stale trailers, push failure).
 *                     Deliberately named for what the manifest actually knows,
 *                     so the escaped-defect / cost-per-bug reports never count
 *                     an authorized-but-unmerged campaign as a shipped merge.
 *  - "passed"       : review completed, judge recorded, 0 blocking, no merge asked.
 *  - "blocked"      : judge recorded a blocking count > 0.
 *  - "incomplete"   : no judge artifact, or a judge bound to a head other than
 *                     the one being recorded (campaign stopped before synthesis
 *                     — budget exhaustion, error, a still-running record call,
 *                     or commits landed after the judge without a re-judge).
 *                     A stale judge describes a DIFFERENT head than the recorded
 *                     `head` column, so its blocking count cannot be trusted for
 *                     the current revision — mirrors the staleness contract in
 *                     quality-invocation.js review-authorization.
 */
function deriveVerdict(manifest) {
  const judge = manifest.judge;
  if (!judge || !Number.isFinite(judge.blockingCount)) return "incomplete";
  if (judge.head !== manifest.revisions?.currentHead) return "incomplete";
  if (judge.blockingCount > 0) return "blocked";
  return manifest.options?.merge === true ? "authorized" : "passed";
}

/**
 * Campaign wall-clock, from the governor's start epoch to the record moment.
 * Null when either bound is unavailable; clamped at 0 so clock skew or a
 * relocated manifest never records a negative duration.
 */
function campaignDuration(manifest, nowIso) {
  const startedAtEpoch = manifest.governor?.startedAtEpoch;
  const endedAtEpoch = Math.floor(Date.parse(nowIso) / 1000);
  if (!Number.isFinite(startedAtEpoch) || !Number.isFinite(endedAtEpoch)) {
    return null;
  }
  return Math.max(0, endedAtEpoch - startedAtEpoch);
}

/** Coalesce `undefined` to `null` for a stable JSONL column set. */
function orNull(value) {
  return value === undefined ? null : value;
}

/**
 * The manifest's flat identity fields (repo/PR/branch/revisions/risk). Split
 * out of buildRecord to keep each function readable; `orNull` keeps the branch
 * count low (a bare `?? null` per column otherwise reads as N conditionals to
 * the complexity linter). Risk fields are recorded only once resolved, so an
 * unresolved campaign never logs a stale requested tier as if it were final.
 *
 * The absolute repo realpath is DELIBERATELY NOT recorded: it is a host path
 * (`/Users/<name>/...`) that would leak into any committed telemetry log —
 * unacceptable in a public repo. `repoKey` + `githubRepository` identify the
 * repo without exposing the operator's filesystem.
 */
function identityFields(manifest) {
  const repo = manifest.repo || {};
  const revisions = manifest.revisions || {};
  const risk = manifest.risk || {};
  const resolved = risk.resolved === true;
  return {
    repoKey: orNull(repo.key),
    githubRepository: orNull(repo.githubRepository),
    pr: orNull(repo.pr),
    branch: orNull(repo.headRefName),
    baseSha: orNull(revisions.baseSha),
    head: orNull(revisions.currentHead),
    taskType: resolved ? orNull(risk.taskType) : null,
    riskTier: resolved ? orNull(risk.tier) : null,
    riskScore: resolved ? orNull(risk.score) : null,
    requestedLevel: orNull(risk.requestedLevel),
  };
}

function reviewFields(manifest) {
  const provider = manifest.provider || {};
  const inferredArm =
    provider.reviewer === "claude"
      ? "bespoke"
      : ["codex", "gemini"].includes(provider.reviewer)
        ? "native"
        : null;
  return {
    // Older manifests predate the experiment and remain reportable as null.
    // All newly-created manifests persist one of these arms at creation time.
    reviewArm: manifest.options?.reviewArm ?? inferredArm,
    reviewProvider: provider.reviewer ?? null,
    reviewEffort: provider.effort ?? null,
    // Provider CLIs do not expose a stable cross-provider token counter yet.
    // Preserve the absence explicitly rather than estimating from wall time.
    reviewTokens: null,
  };
}

function validateRecord(record) {
  const validArm =
    record.reviewArm === null ||
    ["bespoke", "native"].includes(record.reviewArm);
  const validTokens =
    record.reviewTokens === null ||
    (Number.isInteger(record.reviewTokens) && record.reviewTokens >= 0);
  return Boolean(
    record.telemetrySchemaVersion === TELEMETRY_SCHEMA_VERSION &&
    typeof record.invocationId === "string" &&
    typeof record.recordedAt === "string" &&
    validArm &&
    (record.reviewProvider === null ||
      typeof record.reviewProvider === "string") &&
    (record.reviewEffort === null || typeof record.reviewEffort === "string") &&
    validTokens,
  );
}

/**
 * Build the one telemetry record for a finished campaign. Pure given a manifest
 * and a git runner (injected for testability). All fields trace to the manifest.
 */
function buildRecord(manifest, { execFileSync, nowIso }) {
  const judge = manifest.judge || {};
  const record = {
    telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
    invocationId: manifest.invocationId,
    recordedAt: nowIso,
    ...identityFields(manifest),
    ...reviewFields(manifest),
    durationSeconds: campaignDuration(manifest, nowIso),
    reviewRounds: successfulReviewCount(manifest),
    agentsRun: Array.isArray(manifest.agents) ? manifest.agents.length : 0,
    blockingCount: Number.isFinite(judge.blockingCount)
      ? judge.blockingCount
      : null,
    mergeRequested: manifest.options?.merge === true,
    verdict: deriveVerdict(manifest),
    coveredFiles: coveredFiles(manifest, execFileSync),
  };
  if (!validateRecord(record)) {
    throw new Error("quality telemetry record is missing required attribution");
  }
  return record;
}

/**
 * Return true if the log already contains a line for this invocationId.
 * Read-tolerant: a missing file is "not present"; a malformed line is skipped
 * (a single corrupt line must not resurrect a duplicate append nor throw).
 */
function alreadyRecorded(logPath, invocationId) {
  let raw;
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch {
    return false;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      if (JSON.parse(trimmed).invocationId === invocationId) return true;
    } catch {
      // skip corrupt line
    }
  }
  return false;
}

function appendRecord(logPath, record) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(record) + "\n");
}

/**
 * `record` subcommand. Reads the manifest, builds the summary, appends once.
 * Returns a process exit code. A write failure warns but returns 0 — telemetry
 * is observational and must never block a campaign's real outcome.
 */
function recordCampaign(manifestPath, deps = {}) {
  const execFileSync =
    deps.execFileSync || require("child_process").execFileSync;
  const nowIso = deps.nowIso || new Date().toISOString();
  let manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (error) {
    process.stderr.write(
      `[quality] telemetry: manifest unreadable at ${manifestPath} — ${error.message}\n`,
    );
    return 1;
  }
  const logPath = resolveTelemetryFile(manifest);
  if (alreadyRecorded(logPath, manifest.invocationId)) {
    process.stdout.write(
      `[quality] telemetry: campaign ${manifest.invocationId} already recorded — skipping.\n`,
    );
    return 0;
  }
  const record = buildRecord(manifest, { execFileSync, nowIso });
  try {
    appendRecord(logPath, record);
  } catch (error) {
    process.stderr.write(
      `[quality] telemetry: could not write ${logPath} — ${error.message} (campaign outcome unaffected).\n`,
    );
    return 0;
  }
  process.stdout.write(
    `[quality] telemetry: recorded campaign ${manifest.invocationId} (${record.verdict}, ${record.durationSeconds}s) -> ${logPath}\n`,
  );
  return 0;
}

function main() {
  const [, , cmd, manifestPath] = process.argv;
  if (cmd !== "record" || !manifestPath) {
    process.stderr.write(
      "usage: quality-telemetry.js record <manifest-path>\n",
    );
    process.exit(2);
  }
  process.exit(recordCampaign(manifestPath));
}

module.exports = {
  TELEMETRY_SCHEMA_VERSION,
  resolveTelemetryFile,
  successfulReviewCount,
  coveredFiles,
  deriveVerdict,
  buildRecord,
  validateRecord,
  alreadyRecorded,
  recordCampaign,
};

if (require.main === module) {
  main();
}
