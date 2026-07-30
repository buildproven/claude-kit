#!/usr/bin/env node
"use strict";

/**
 * risk-score.js — kit-native review-depth scorer.
 *
 * Computes a 0–100 risk score for the current change from `git diff` alone, so
 * the quality skill can scale machine-review depth (Claude agent count, Codex
 * effort, Codex rounds) proportionally. Works in ANY repo with zero per-repo
 * setup: built-in defaults cover the common cases; a repo's harness-config.json
 * (scorePolicy/securityFloor/mergeAuthority) is merged over the defaults when
 * present.
 *
 * Why this exists: review is machine-only (Claude finds, Codex verifies) on
 * flat-rate subscriptions, so the real cost is wall-clock. Running the full
 * 6-agent + Codex-adversarial pass on a one-line comment change is pure waste;
 * skipping depth on a security-surface change is dangerous. The score scales
 * depth between those — but never to zero. Merge authority is a separate,
 * explicit policy: autonomous by default, with manual governance available as
 * an opt-in for repositories that need it.
 *
 * Design constraints:
 *   - Zero runtime dependencies (must run in 23 repos with no node_modules).
 *   - Deterministic + explainable (every score ships a `reasons[]` trail).
 *   - Conservative: mechanical/size heuristics can only LOWER score off a
 *     non-sensitive base, never below the security floor; magnitude only raises.
 *
 * Output (JSON to stdout, or GITHUB_OUTPUT lines when that env is set):
 *   { riskScore, taskType, changeNature, diffStats, reasons, knobs }
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
// Shared, single-sourced change-nature primitives (see risk-change-nature.js).
// Formerly duplicated here and in scripts/risk-policy-gate.js — extracted to end
// the drift. This file keeps only its own `fileIsMechanical` (which legitimately
// differs from the setup gate's dep-bump/generated-path variant) and injects it.
const {
  patchIsCommentWhitespaceOnly,
  patchIsAdditiveOnly,
  isTestPath,
  isForcedLogic,
  classifyChangeNature: classifyChangeNatureShared,
} = require("./risk-change-nature");

const CRITICAL_RISK_SCORE = 75;

// ---------------------------------------------------------------------------
// Built-in defaults (overridable via harness-config.json: scorePolicy)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // Review risk controls how deeply the system verifies a change; it is not a
  // proxy for whether an operator must type an approval command. New quality
  // campaigns merge autonomously once their revision-bound evidence is clean.
  // A repository can explicitly retain the legacy signed human capability by
  // setting scorePolicy.mergeAuthority to "human-required".
  mergeAuthority: "autonomous",
  // Path → base score. First matching tier wins (most-sensitive first).
  // Security surface pins a high floor regardless of change nature.
  securityFloor: [
    "**/.github/workflows/**",
    "**/.husky/**",
    "**/*.husky/**",
    "**/auth/**",
    "**/*auth*/**",
    "**/licensing*.*",
    "**/license*.*",
    "**/*licens*/**",
    "**/*secret*",
    "**/*secret*/**",
    "**/*credential*",
    "**/*credential*/**",
    "**/*password*",
    "**/*password*/**",
    "**/*passwd*",
    "**/*passwd*/**",
    "**/*token*",
    "**/*token*/**",
    "**/deploy*.*",
    "**/*deploy-*.*",
    "**/*deploy*/**",
    "**/install.sh",
    "**/webhook*.*",
    "**/*webhook*/**",
    "**/key/**",
    "**/keys/**",
    "**/*-key/**",
    "**/*-keys/**",
    "**/*_key/**",
    "**/*_keys/**",
    "**/key*/**",
    "**/*-key*/**",
    "**/*_key*/**",
    "**/*keystore*/**",
    "**/*keyring*/**",
    "**/*keychain*/**",
    "**/key.*",
    "**/keys.*",
    "**/key-*.*",
    "**/key_*.*",
    "**/*-key*.*",
    "**/*_key*.*",
    "**/*apikey*.*",
    "**/*privatekey*.*",
    "**/*secretkey*.*",
    "**/*accesskey*.*",
    "**/*signingkey*.*",
    "**/*keystore*.*",
    "**/*keyring*.*",
    "**/*keychain*.*",
    "**/middleware.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/*.jks",
    "**/*.keystore",
    "**/*.ppk",
    "**/*.pk8",
    "**/*.kdb",
    "**/*.kdbx",
    "**/id_rsa*",
    "**/id_dsa*",
    "**/id_ecdsa*",
    "**/id_ed25519*",
    "**/.env*",
    "**/harness-config.json",
  ],
  // The legacy manual-governance subset of the security floor. It is evaluated
  // only when a repository explicitly selects mergeAuthority=human-required.
  // Repositories may EXTEND this list via scorePolicy.humanFloor, but cannot
  // remove the built-in minimum: policy from the reviewed revision must never
  // relax its own manually governed surface.
  // Matched CASE-INSENSITIVELY (see touchesHumanFloor) so AUTH/, .PEM, .Env
  // cannot evade by casing. Token-broad on purpose: a floor that misses id_rsa,
  // .p12, oauth, or password is not a floor (Codex + security-auditor review).
  humanFloor: [
    "**/auth/**",
    "**/*auth*", // oauth, authn, authz, auth-config …
    "**/*auth*/**",
    "**/licensing*.*",
    "**/license*.*",
    "**/*licens*/**",
    "**/*secret*",
    "**/*secret*/**",
    "**/*credential*",
    "**/*credential*/**",
    "**/*password*",
    "**/*password*/**",
    "**/*passwd*",
    "**/*passwd*/**",
    "**/*token*",
    "**/*token*/**",
    "**/deploy/**",
    "**/deploy*.*",
    "**/*deploy-*.*",
    "**/*deploy*/**",
    "**/webhook*.*",
    "**/*webhook*/**",
    "**/key/**",
    "**/keys/**",
    "**/*-key/**",
    "**/*-keys/**",
    "**/*_key/**",
    "**/*_keys/**",
    "**/key*/**",
    "**/*-key*/**",
    "**/*_key*/**",
    "**/*keystore*/**",
    "**/*keyring*/**",
    "**/*keychain*/**",
    "**/key.*",
    "**/keys.*",
    "**/key-*.*",
    "**/key_*.*",
    "**/*-key*.*",
    "**/*_key*.*",
    "**/*apikey*.*",
    "**/*privatekey*.*",
    "**/*secretkey*.*",
    "**/*accesskey*.*",
    "**/*signingkey*.*",
    "**/*keystore*.*",
    "**/*keyring*.*",
    "**/*keychain*.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/*.jks",
    "**/*.keystore",
    "**/*.ppk",
    "**/*.pk8",
    "**/*.kdb",
    "**/*.kdbx",
    "**/id_rsa*",
    "**/id_dsa*",
    "**/id_ecdsa*",
    "**/id_ed25519*",
    "**/.env*",
    "**/harness-config.json",
  ],
  // High-sensitivity (non-floor) source paths.
  high: ["**/api/**", "**/server/**", "**/db/**", "**/payments/**"],
  // Low-sensitivity paths.
  low: [
    "**/*.md",
    "**/docs/**",
    "**/LICENSE",
    "**/CHANGELOG*",
    "**/__tests__/**",
    "**/tests/**",
    "**/test/**",
    "**/*.test.*",
    "**/*.spec.*",
  ],
  base: {
    securityFloor: 85, // pinned floor for sensitive surface
    high: 60,
    medium: 35, // default for unclassified source
    low: 10,
  },
  // Path patterns from securityFloor whose floor classification is
  // content-gated rather than an unconditional path pin (BUI-381). A file
  // matching one of these still starts in securityFloor's path tier, but is
  // only actually HELD at the floor score if its diff touches risk-bearing
  // content (see workflowDiffIsRiskBearing); otherwise it is downgraded to
  // the `high` tier so a one-line comment/version-pin edit doesn't force the
  // same critical-tier review as a permissions/secrets/run: rewrite.
  contentAwareFloor: ["**/.github/workflows/**"],
  mechanicalDelta: -25, // bounded subtraction for mechanical changes
  magnitude: {
    // Diff size adds risk and caps how far mechanical can subtract.
    linesForSmall: 50, // ≤ this: no size add
    linesForLarge: 600, // ≥ this: full size add
    maxAdd: 20, // max points added by size
    capMechanicalAboveLines: 400, // large diffs cannot be treated as low-risk
  },
  // Score → review depth. Moderate curve (user-chosen).
  curve: [
    { maxScore: 20, agents: 2, codex: "skip", codexRounds: 0 },
    { maxScore: 50, agents: 4, codex: "high", codexRounds: 1 },
    {
      maxScore: CRITICAL_RISK_SCORE - 1,
      agents: 6,
      codex: "high",
      codexRounds: 1,
    },
    { maxScore: 100, agents: 6, codex: "xhigh", codexRounds: 1 },
  ],
  // Score ≥ this always runs Codex even if the band says skip.
  codexForceFloor: 75,
};

// ---------------------------------------------------------------------------
// Tiny zero-dependency glob matcher (subset: ** * ? and literals)
// ---------------------------------------------------------------------------

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** → match across path separators (and an optional trailing /)
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // collapse **/ so it can match zero dirs
      } else {
        re += "[^/]*"; // * → within a single segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  // Git permits control characters, including newlines, in path segments.
  // DotAll keeps `**` faithful to "any characters across separators"; without
  // it, `safe\n/auth/session.js` evades an otherwise matching `**/auth/**`.
  return new RegExp("^" + re + "$", "s");
}

const _matcherCache = new Map();
function matchesPattern(filepath, patterns) {
  for (const pattern of patterns || []) {
    let rx = _matcherCache.get(pattern);
    if (!rx) {
      rx = globToRegExp(pattern);
      _matcherCache.set(pattern, rx);
    }
    if (rx.test(filepath)) return true;
  }
  return false;
}

function normalizeFloorPath(file) {
  return String(file).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function hasControlCharacters(file) {
  return Array.from(String(file)).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function additiveFloorPatterns(defaultPatterns, configuredPatterns) {
  const configured = Array.isArray(configuredPatterns)
    ? configuredPatterns
    : [];
  return [
    ...new Set(
      [...defaultPatterns, ...configured].map((pattern) =>
        pattern.toLowerCase(),
      ),
    ),
  ];
}

function effectiveSecurityFloor(cfg = DEFAULTS) {
  return additiveFloorPatterns(
    [...DEFAULTS.securityFloor, ...DEFAULTS.humanFloor],
    cfg?.securityFloor,
  );
}

function matchesSecurityFloor(file, cfg = DEFAULTS) {
  // Git accepts control characters in filenames. Treat every such path as
  // security-sensitive instead of trying to assign ordinary risk to an
  // ambiguous/adversarial display surface.
  if (hasControlCharacters(file)) return true;
  return matchesPattern(normalizeFloorPath(file), effectiveSecurityFloor(cfg));
}

function securityFloorScore(cfg = DEFAULTS) {
  const configured = Number(cfg?.base?.securityFloor);
  return Math.max(
    DEFAULTS.base.securityFloor,
    Number.isFinite(configured) ? configured : DEFAULTS.base.securityFloor,
  );
}

// ---------------------------------------------------------------------------
// git helpers (injectable runner for tests)
// ---------------------------------------------------------------------------

function defaultGitRunner(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Resolve the base ref the diff is scored against. Determinism matters: the
// same change MUST score the same regardless of which refs happen to be fetched
// locally. The old last-resort of `HEAD~1` was the bug — in a freshly
// materialized worktree without origin/main fetched, it silently diffed only
// the last commit, so a large branch scored like a one-line change (observed:
// 35 vs 87 for the same diff). When no durable base can be found we do NOT
// quietly fall back to a one-commit diff; we return { unresolved: true } and let
// the caller fail CLOSED (score maximum risk) instead of a misleadingly low one.
function resolveBase(gitRunner, baseArg) {
  if (baseArg) return { ref: baseArg };
  if (process.env.GITHUB_BASE_REF)
    return { ref: `origin/${process.env.GITHUB_BASE_REF}` };
  // Prefer the tracked upstream of the current branch — the true PR base — over
  // guessing origin/main, and try to fetch a known remote base if it is missing
  // locally so a fresh worktree scores the same as a full checkout.
  try {
    const upstream = gitRunner([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (upstream) {
      gitRunner(["rev-parse", "--verify", "--quiet", `${upstream}^{commit}`]);
      return { ref: upstream };
    }
  } catch {
    /* no upstream configured — fall through */
  }
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    try {
      gitRunner(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return { ref };
    } catch {
      /* try next */
    }
  }
  // No durable base. Do not silently diff HEAD~1 — that is the non-determinism
  // that let a big change score small. Signal it; the caller fails closed.
  return { unresolved: true };
}

// ---------------------------------------------------------------------------
// Change-nature classification (mechanical vs logic)
// ---------------------------------------------------------------------------

// The 9 shared predicates (isCommentWhitespaceSafeLang, isDirectiveComment,
// isWholeLineInertComment, patchIsCommentWhitespaceOnly, patchIsAdditiveOnly,
// isTestPath, isExecutablePromptSurface, isForcedLogic, classifyChangeNature)
// now live in ./risk-change-nature.js and are imported above. Only the pieces
// unique to the numeric scorer remain local.

// This scorer's mechanical sub-rule set: test additions + inert comment edits,
// never a floor file. (The setup gate's variant additionally treats dep-version
// bumps and generated-file refreshes as mechanical — that is why the sub-rule
// is injected into the shared classifier rather than living in it.)
function fileIsMechanical(file, status, patch, floorPaths, descriptor = {}) {
  if (
    matchesPattern(
      normalizeFloorPath(file),
      additiveFloorPatterns(DEFAULTS.securityFloor, floorPaths),
    )
  )
    return false; // floor files are never mechanical
  if (descriptor.pureRename === true) return true;
  const testRuleAllowed = isTestPath(file);
  return (
    (testRuleAllowed && status === "A") ||
    (testRuleAllowed && patchIsAdditiveOnly(patch)) ||
    patchIsCommentWhitespaceOnly(file, patch)
  );
}

/**
 * Classify the whole changeset using this scorer's native call convention
 * (descriptors + a floorPaths array), delegating the drift-prone control flow to
 * the shared classifier and injecting this file's matcher + fileIsMechanical.
 */
function classifyChangeNature(descriptors, floorPaths) {
  const normalizedDescriptors = descriptors.map((descriptor) => ({
    ...descriptor,
    file: normalizeFloorPath(descriptor.file),
  }));
  return classifyChangeNatureShared(normalizedDescriptors, {
    floorPaths: additiveFloorPatterns(DEFAULTS.securityFloor, floorPaths),
    matchesPattern,
    fileIsMechanical,
  });
}

// ---------------------------------------------------------------------------
// Diff collection
// ---------------------------------------------------------------------------

function collectDescriptors(base, gitRunner) {
  let mergeBase;
  try {
    mergeBase = gitRunner(["merge-base", "HEAD", base]) || base;
  } catch {
    mergeBase = base;
  }

  const nameStatus = safeGit(gitRunner, [
    "diff",
    "--name-status",
    "--find-renames",
    "-z",
    `${mergeBase}...HEAD`,
  ]);
  const numstat = safeGit(gitRunner, [
    "diff",
    "--numstat",
    "--find-renames",
    "-z",
    `${mergeBase}...HEAD`,
  ]);

  const statuses = parseNameStatusZ(nameStatus);
  const stats = parseNumstatZ(numstat);
  const submoduleStats = collectSubmoduleDiffStats(mergeBase, gitRunner);

  let totalLines = 0;
  const descriptors = [];
  for (let index = 0; index < stats.length; index += 1) {
    const { add, del, paths } = stats[index];
    const statusInfo = statuses[index] || {
      status: "M",
      baseFile: paths[0],
      file: paths.at(-1),
      similarity: null,
    };
    const file = statusInfo.file || paths.at(-1);
    const isBinary = add === "-" && del === "-";
    const lines = isBinary
      ? 0
      : (parseInt(add, 10) || 0) + (parseInt(del, 10) || 0);
    totalLines += lines;
    descriptors.push(
      collectDescriptor({
        file,
        isBinary,
        lines,
        statusInfo,
        mergeBase,
        gitRunner,
      }),
    );
  }

  return {
    descriptors,
    diffStats: {
      files: descriptors.length + submoduleStats.files,
      lines: totalLines + submoduleStats.lines,
    },
    mergeBase,
  };
}

function collectSubmoduleDiffStats(mergeBase, gitRunner) {
  // A gitlink's numstat is "-\t-\tpath", so it otherwise contributes zero
  // workload even though review expands the referenced submodule history. Read
  // the raw object IDs and, when the submodule checkout and both pinned commits
  // are available, include its own base..head numstat in the parent workload.
  // This is deliberately best-effort: an uninitialized/deleted submodule must
  // never make risk scoring fail or invent a size estimate.
  const raw = safeGit(gitRunner, [
    "diff",
    "--raw",
    "--no-abbrev",
    "-z",
    `${mergeBase}...HEAD`,
  ]);
  let files = 0;
  let lines = 0;
  for (const entry of parseRawZ(raw)) {
    if (
      entry.oldMode !== "160000" ||
      entry.newMode !== "160000" ||
      isNullObjectId(entry.oldObject) ||
      isNullObjectId(entry.newObject)
    ) {
      continue;
    }
    const nested = safeGit(gitRunner, [
      "-C",
      entry.file,
      "diff",
      "--numstat",
      `${entry.oldObject}..${entry.newObject}`,
    ]);
    for (const stat of parseNumstatZ(nested)) {
      const added = Number.parseInt(stat.add, 10) || 0;
      const deleted = Number.parseInt(stat.del, 10) || 0;
      lines += added + deleted;
      files += 1;
    }
  }
  return { files, lines };
}

function parseRawZ(raw) {
  const tokens = String(raw).split("\0");
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const header = tokens[index++];
    if (!header) continue;
    const match = header.match(
      /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z][0-9]*)$/,
    );
    if (!match) continue;
    const [, oldMode, newMode, oldObject, newObject, status] = match;
    const baseFile = tokens[index++] || "";
    const file = ["R", "C"].includes(status[0])
      ? tokens[index++] || ""
      : baseFile;
    rows.push({ oldMode, newMode, oldObject, newObject, file });
  }
  return rows;
}

function isNullObjectId(objectId) {
  return !objectId || /^0+$/.test(objectId);
}

const TASK_TYPE_RANK = {
  unknown: 0,
  chore: 1,
  docs: 2,
  build: 3,
  ci: 4,
  feature: 5,
  bugfix: 6,
  performance: 7,
};
const TASK_TYPES = new Set(Object.keys(TASK_TYPE_RANK));

function conventionalTaskType(subject) {
  const head = String(subject || "")
    .split(":", 1)[0]
    .trim()
    .toLowerCase()
    .replace(/!$/, "")
    .replace(/\([^)]*\)$/, "");
  if (head === "perf") return "performance";
  if (head === "fix" || head === "revert") return "bugfix";
  if (head === "feat") return "feature";
  if (head === "ci") return "ci";
  if (head === "build") return "build";
  if (head === "docs") return "docs";
  if (["chore", "style", "test"].includes(head)) return "chore";
  return "unknown";
}

function pathTaskType(file) {
  const normalized = normalizeFloorPath(file);
  if (
    normalized.startsWith(".github/workflows/") ||
    normalized.startsWith(".circleci/") ||
    normalized === ".gitlab-ci.yml"
  ) {
    return "ci";
  }
  if (
    normalized === "dockerfile" ||
    normalized.endsWith("/dockerfile") ||
    normalized === "makefile" ||
    normalized.endsWith("/makefile") ||
    normalized.startsWith("build/") ||
    normalized.startsWith("scripts/build")
  ) {
    return "build";
  }
  if (
    normalized.endsWith(".md") ||
    normalized.startsWith("docs/") ||
    normalized === "license" ||
    normalized.startsWith("changelog")
  ) {
    return "docs";
  }
  return "unknown";
}

function strictestTaskType(types) {
  return types.reduce(
    (strictest, candidate) =>
      TASK_TYPE_RANK[candidate] > TASK_TYPE_RANK[strictest]
        ? candidate
        : strictest,
    "unknown",
  );
}

function classifyTaskType(descriptors, subjects = []) {
  const fromCommits = strictestTaskType(
    subjects.map((subject) => conventionalTaskType(subject)),
  );
  if (fromCommits !== "unknown") return fromCommits;
  if (descriptors.length === 0) return "unknown";
  const fromPaths = descriptors.map((descriptor) =>
    pathTaskType(descriptor.file),
  );
  if (fromPaths.some((type) => type === "unknown")) return "unknown";
  return strictestTaskType(fromPaths);
}

function collectCommitSubjects(mergeBase, gitRunner) {
  return safeGit(gitRunner, [
    "log",
    "--no-merges",
    "--format=%s",
    `${mergeBase}..HEAD`,
  ])
    .split("\n")
    .map((subject) => subject.trim())
    .filter(Boolean);
}

function applyTaskTypeFloor(scored, taskType, cfg) {
  const floors = {
    feature: cfg.base.medium,
  };
  const floor = floors[taskType];
  if (!Number.isFinite(floor) || scored.riskScore >= floor) return scored;
  return {
    ...scored,
    riskScore: floor,
    reasons: [
      ...scored.reasons,
      `task type ${taskType} → ${
        taskType === "feature" ? "standard" : "high-review"
      } floor ${floor}`,
    ],
  };
}

function parseNameStatusZ(raw) {
  if (!String(raw).includes("\0")) {
    return String(raw)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [code, baseFile, renamedFile] = line.split("\t");
        const status = code[0];
        return {
          status,
          similarity: /^[RC][0-9]+$/.test(code) ? Number(code.slice(1)) : null,
          baseFile,
          file: ["R", "C"].includes(status) ? renamedFile : baseFile,
        };
      });
  }
  const tokens = String(raw).split("\0");
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++];
    if (!code) continue;
    const status = code[0];
    const similarity = /^[RC][0-9]+$/.test(code) ? Number(code.slice(1)) : null;
    const baseFile = tokens[index++] || "";
    const file = ["R", "C"].includes(status) ? tokens[index++] || "" : baseFile;
    rows.push({ status, similarity, baseFile, file });
  }
  return rows;
}

function parseNumstatZ(raw) {
  if (!String(raw).includes("\0")) {
    return String(raw)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [add, del, file] = line.split("\t");
        return { add, del, paths: [file] };
      });
  }
  const tokens = String(raw).split("\0");
  const rows = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++];
    if (!token) continue;
    const [add, del, file] = token.split("\t");
    if (file === "") {
      rows.push({
        add,
        del,
        paths: [tokens[index++] || "", tokens[index++] || ""],
      });
    } else {
      rows.push({ add, del, paths: [file] });
    }
  }
  return rows;
}

function collectDescriptor({
  file,
  isBinary,
  lines,
  statusInfo,
  mergeBase,
  gitRunner,
}) {
  const status = statusInfo.status;
  let patch = "";
  if (!isBinary && status !== "D") {
    patch = safeGit(gitRunner, ["diff", `${mergeBase}...HEAD`, "--", file]);
    if (patch.length > 200 * 1024) patch = "";
  }
  const descriptor = {
    file,
    baseFile: statusInfo.baseFile,
    status,
    isBinary,
    lines,
    patch,
    similarity: statusInfo.similarity,
    pureRename: status === "R" && statusInfo.similarity === 100 && lines === 0,
  };
  if (matchesPattern(file, ["**/package.json"])) {
    descriptor.manifest = collectManifestSnapshots(
      descriptor,
      mergeBase,
      gitRunner,
    );
  }
  return descriptor;
}

function tryGit(gitRunner, args) {
  try {
    return { ok: true, value: gitRunner(args) };
  } catch {
    return { ok: false, value: "" };
  }
}

function collectManifestSnapshots(descriptor, mergeBase, gitRunner) {
  const before =
    descriptor.status === "A"
      ? { ok: true, value: null }
      : tryGit(gitRunner, [
          "show",
          `${mergeBase}:${descriptor.baseFile || descriptor.file}`,
        ]);
  const after =
    descriptor.status === "D"
      ? { ok: true, value: null }
      : tryGit(gitRunner, ["show", `HEAD:${descriptor.file}`]);
  return { before, after };
}

function safeGit(gitRunner, args) {
  try {
    return gitRunner(args) || "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function pathBase(file, cfg) {
  if (matchesSecurityFloor(file, cfg)) return securityFloorScore(cfg);
  if (matchesPattern(file, cfg.high)) return cfg.base.high;
  if (matchesPattern(file, cfg.low)) return cfg.base.low;
  return cfg.base.medium;
}

function magnitudeAdd(lines, cfg) {
  const { linesForSmall, linesForLarge, maxAdd } = cfg.magnitude;
  if (lines <= linesForSmall) return 0;
  if (lines >= linesForLarge) return maxAdd;
  const frac = (lines - linesForSmall) / (linesForLarge - linesForSmall);
  return Math.round(frac * maxAdd);
}

const MANIFEST_CRITICAL_FIELDS = new Set(["overrides", "resolutions"]);
const MANIFEST_HIGH_FIELDS = new Set([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "scripts",
  "bin",
  "exports",
  "imports",
  "main",
  "module",
  "browser",
  "type",
  "types",
  "typings",
  "files",
  "name",
  "workspaces",
  "packageManager",
  "publishConfig",
]);
const MANIFEST_MEDIUM_FIELDS = new Set([
  "devDependencies",
  "engines",
  "os",
  "cpu",
  "version",
  "license",
  "private",
]);
const MANIFEST_LOW_FIELDS = new Set([
  "description",
  "keywords",
  "homepage",
  "bugs",
  "author",
  "contributors",
  "funding",
  "repository",
]);
const INSTALL_LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
]);
const DEPENDENCY_FIELDS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
]);

function parseManifestSnapshot(snapshot) {
  if (!snapshot || snapshot.ok !== true) return { ok: false, value: null };
  if (snapshot.value === null) return { ok: true, value: null };
  try {
    const value = JSON.parse(snapshot.value);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ok: true, value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

function changedTopLevelFields(before, after) {
  const fields = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  return [...fields].filter(
    (field) =>
      JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]),
  );
}

function hasNonRegistryDependencySource(value) {
  if (typeof value === "string") {
    return !isRegistryDependencySpec(value);
  }
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasNonRegistryDependencySource);
}

function isRegistryDependencySpec(value) {
  const spec = value.trim();
  if (!spec) return false;
  const normalized = spec.toLowerCase();
  if (normalized.endsWith(".tgz") || normalized.endsWith(".tar.gz"))
    return false;
  if (spec.startsWith("workspace:")) {
    return isPlainRegistrySelector(spec.slice("workspace:".length));
  }
  if (spec.startsWith("npm:")) {
    return isRegistryAlias(spec.slice("npm:".length));
  }
  return isPlainRegistrySelector(spec);
}

function isRegistryAlias(alias) {
  const separator = alias.startsWith("@")
    ? alias.indexOf("@", alias.indexOf("/") + 1)
    : alias.indexOf("@");
  const name = separator >= 0 ? alias.slice(0, separator) : alias;
  const selector = separator >= 0 ? alias.slice(separator + 1) : "";
  return (
    isRegistryPackageName(name) &&
    (!selector || isPlainRegistrySelector(selector))
  );
}

function isRegistryPackageName(name) {
  if (!name || [...name].some((character) => character.trim() === ""))
    return false;
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    return (
      slash > 1 &&
      slash === name.lastIndexOf("/") &&
      slash < name.length - 1 &&
      !name.includes(":") &&
      !name.includes("\\")
    );
  }
  return !["/", ":", "@", "\\"].some((character) => name.includes(character));
}

function isPlainRegistrySelector(spec) {
  if (!spec || spec.startsWith(".")) return false;
  const hasWhitespace = [...spec].some((character) => character.trim() === "");
  const hasRangeSignal = [...spec].some(
    (character) =>
      (character >= "0" && character <= "9") || "<>=~^*|".includes(character),
  );
  if (hasWhitespace && !hasRangeSignal) return false;
  return !["/", ":", "@", "\\"].some((character) => spec.includes(character));
}

function manifestFieldRisk(field, before, after, cfg) {
  const afterValue = after[field];
  if (MANIFEST_CRITICAL_FIELDS.has(field)) {
    return {
      score: cfg.base.securityFloor,
      reason: `critical manifest field changed: ${field}`,
    };
  }
  if (
    field === "scripts" &&
    changedTopLevelFields(before.scripts, after.scripts).some((name) =>
      INSTALL_LIFECYCLE_SCRIPTS.has(name),
    )
  ) {
    return {
      score: cfg.base.securityFloor,
      reason: "install lifecycle script changed",
    };
  }
  if (
    DEPENDENCY_FIELDS.has(field) &&
    hasNonRegistryDependencySource(afterValue)
  ) {
    return {
      score: cfg.base.securityFloor,
      reason: `non-registry dependency source changed: ${field}`,
    };
  }
  if (MANIFEST_HIGH_FIELDS.has(field)) {
    return {
      score: cfg.base.high,
      reason: `runtime manifest field changed: ${field}`,
    };
  }
  if (MANIFEST_MEDIUM_FIELDS.has(field) || !MANIFEST_LOW_FIELDS.has(field)) {
    return {
      score: cfg.base.medium,
      reason: `manifest field changed: ${field}`,
    };
  }
  return { score: cfg.base.low, reason: "manifest metadata only" };
}

function manifestRisk(descriptor, cfg = DEFAULTS) {
  if (
    !descriptor.manifest ||
    ["A", "D", "R", "C", "T"].includes(descriptor.status)
  ) {
    return {
      score: cfg.base.securityFloor,
      fields: [],
      reason: "manifest added, deleted, renamed, copied, or type-changed",
    };
  }

  const before = parseManifestSnapshot(descriptor.manifest.before);
  const after = parseManifestSnapshot(descriptor.manifest.after);
  if (!before.ok || !after.ok || !before.value || !after.value) {
    return {
      score: cfg.base.securityFloor,
      fields: [],
      reason: "manifest base or HEAD snapshot unreadable or invalid",
    };
  }

  const fields = changedTopLevelFields(before.value, after.value);
  const risks = fields.map((field) =>
    manifestFieldRisk(field, before.value, after.value, cfg),
  );
  const highest = risks.reduce(
    (highest, risk) => (risk.score > highest.score ? risk : highest),
    { score: cfg.base.low, reason: "manifest metadata only" },
  );
  return { ...highest, fields };
}

// Risk-bearing GitHub Actions diff hunk content (BUI-381): a workflow diff
// that ONLY touches version pins, comments, `on:` triggers, or job/step
// names is not the same risk as one that touches permissions, secrets, or
// what actually executes. Conservative by construction — added OR removed
// lines matching any of these patterns are enough to keep the floor; only a
// diff with NONE of these signals downgrades. An unparsable/empty patch
// (e.g. binary, truncated >200KB) is treated as risk-bearing (fail closed).
const WORKFLOW_RISK_PATTERNS = [
  /^permissions\s*:/i, // top-level or job-level permissions block
  /permissions\s*:\s*\{/i, // inline permissions map
  /\bsecrets\s*\.\s*[A-Z0-9_]+/, // secrets.FOO reference (added or removed)
  /\bsecrets\s*:/i, // secrets: passthrough block (reusable workflow calls)
  /^\s*run\s*:/i, // run: shell step content
  /^\s*uses\s*:/i, // any uses: line change — new action pin or reference swap
  /\benv\s*:\s*$/i, // env: block header (new/changed env injection point)
  /\bGITHUB_TOKEN\b/,
  /\bpull_request_target\b/i, // notoriously unsafe trigger
];

function workflowDiffIsRiskBearing(patch) {
  if (!patch || !patch.trim()) return true; // fail closed on empty/unreadable
  for (const line of patch.split("\n")) {
    if (!(line.startsWith("+") || line.startsWith("-"))) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const content = line.slice(1);
    if (WORKFLOW_RISK_PATTERNS.some((pattern) => pattern.test(content))) {
      return true;
    }
  }
  return false;
}

function descriptorBaseRisk(descriptor, cfg) {
  if (
    matchesPattern(descriptor.file, ["**/package.json"]) &&
    !matchesSecurityFloor(descriptor.file, cfg)
  ) {
    return manifestRisk(descriptor, cfg);
  }
  if (
    matchesPattern(descriptor.file, cfg.contentAwareFloor || []) &&
    !workflowDiffIsRiskBearing(descriptor.patch)
  ) {
    return {
      score: cfg.base.high,
      reason:
        "workflow diff touches only version pins/comments/triggers → high, not security floor",
    };
  }
  return { score: pathBase(descriptor.file, cfg), reason: "" };
}

function computeScore(descriptors, diffStats, cfg) {
  const reasons = [];
  if (descriptors.length === 0) {
    return {
      riskScore: cfg.base.medium,
      changeNature: "logic",
      reasons: ["no changes detected → default medium"],
    };
  }

  // Base = highest path sensitivity across all files.
  let base = 0;
  let topFile = "";
  let topReason = "";
  for (const d of descriptors) {
    const risk = descriptorBaseRisk(d, cfg);
    if (risk.score > base) {
      base = risk.score;
      topFile = d.file;
      topReason = risk.reason;
    }
  }
  // A file matches the (additive, repo-extensible) security floor by path
  // but is excluded from touchesFloor when it is ALSO in contentAwareFloor
  // (currently just workflow YAML) AND its own diff is provably not
  // risk-bearing (BUI-381). Any other floor file (secrets, auth, deploy,
  // install.sh, humanFloor, a repo's own extensions, etc.) is an
  // unconditional path pin, unchanged. This must mirror descriptorBaseRisk's
  // downgrade exactly, or a downgraded file's score could still get
  // re-pinned to the floor right back here.
  const touchesFloor = descriptors.some((d) => {
    if (!matchesSecurityFloor(d.file, cfg)) return false;
    if (matchesPattern(d.file, cfg.contentAwareFloor || [])) {
      return workflowDiffIsRiskBearing(d.patch);
    }
    return true;
  });
  reasons.push(`path base ${base} (most-sensitive: ${topFile || "n/a"})`);
  if (topReason) reasons.push(topReason);

  const changeNature = classifyChangeNature(
    descriptors,
    effectiveSecurityFloor(cfg),
  );
  let score = base;

  // Mechanical downgrade — never on a floor touch, bounded, capped by size.
  if (changeNature === "mechanical" && !touchesFloor) {
    if (diffStats.lines >= cfg.magnitude.capMechanicalAboveLines) {
      reasons.push(
        `mechanical but ${diffStats.lines} lines ≥ cap → no downgrade`,
      );
    } else {
      score += cfg.mechanicalDelta;
      reasons.push(`mechanical change → ${cfg.mechanicalDelta}`);
    }
  } else if (touchesFloor) {
    reasons.push("security-surface touched → mechanical downgrade blocked");
  } else {
    reasons.push("logic change → base kept");
  }

  // Magnitude only raises.
  const add = magnitudeAdd(diffStats.lines, cfg);
  if (add > 0) {
    score += add;
    reasons.push(`+${add} for ${diffStats.lines} changed lines`);
  }

  // Security floor pin.
  const floorScore = securityFloorScore(cfg);
  if (touchesFloor && score < floorScore) {
    score = floorScore;
    reasons.push(`pinned to security floor ${floorScore}`);
  }

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) {
    score = 100;
    reasons.push("non-finite risk policy result → maximum risk fail-closed");
  } else {
    score = Math.max(0, Math.min(100, numericScore));
  }
  return { riskScore: score, changeNature, reasons };
}

function nonnegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function configuredKnobs(score, cfg) {
  const curve =
    Array.isArray(cfg?.curve) && cfg.curve.length ? cfg.curve : DEFAULTS.curve;
  const band =
    curve.find((candidate) => score <= Number(candidate.maxScore)) ||
    curve[curve.length - 1];
  return {
    agents: nonnegativeInteger(band?.agents),
    codex: ["skip", "high", "xhigh"].includes(band?.codex)
      ? band.codex
      : "skip",
    codexRounds: nonnegativeInteger(band?.codexRounds),
  };
}

function scoreToKnobs(score, cfg) {
  const numericScore = Number(score);
  const effectiveScore = Number.isFinite(numericScore) ? numericScore : 100;
  const knobs = configuredKnobs(effectiveScore, cfg);
  const configuredForceFloor = Number(cfg?.codexForceFloor);
  const codexForceFloor = Math.min(
    DEFAULTS.codexForceFloor,
    Number.isFinite(configuredForceFloor)
      ? configuredForceFloor
      : DEFAULTS.codexForceFloor,
  );
  if (effectiveScore >= codexForceFloor && knobs.codex === "skip") {
    knobs.codex = "high";
    knobs.codexRounds = 1;
  }
  if (effectiveScore >= CRITICAL_RISK_SCORE) {
    const baseline =
      DEFAULTS.curve.find(
        (candidate) => effectiveScore <= candidate.maxScore,
      ) || DEFAULTS.curve[DEFAULTS.curve.length - 1];
    const codexRank = { skip: 0, high: 1, xhigh: 2 };
    knobs.agents = Math.max(knobs.agents, baseline.agents);
    if ((codexRank[knobs.codex] ?? -1) < codexRank[baseline.codex]) {
      knobs.codex = baseline.codex;
    }
    knobs.codexRounds = Math.max(knobs.codexRounds, baseline.codexRounds);
  }
  return knobs;
}

// ---------------------------------------------------------------------------
// Config merge
// ---------------------------------------------------------------------------

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseConfigJson(raw, file) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid risk policy JSON at ${file}: ${error.message}`, {
      cause: error,
    });
  }
}

function requireFiniteNumber(value, name, { minimum = -Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(
      `invalid risk policy: ${name} must be a finite number >= ${minimum}`,
    );
  }
}

function requirePatternList(value, name) {
  if (
    !Array.isArray(value) ||
    value.some((pattern) => typeof pattern !== "string")
  ) {
    throw new Error(`invalid risk policy: ${name} must be an array of strings`);
  }
}

function validateCurve(curve) {
  if (!Array.isArray(curve) || curve.length === 0) {
    throw new Error("invalid risk policy: curve must be a non-empty array");
  }
  let previousMaximum = -Infinity;
  for (const [index, band] of curve.entries()) {
    if (!band || typeof band !== "object" || Array.isArray(band)) {
      throw new Error(`invalid risk policy: curve[${index}] must be an object`);
    }
    requireFiniteNumber(band.maxScore, `curve[${index}].maxScore`, {
      minimum: 0,
    });
    requireFiniteNumber(band.agents, `curve[${index}].agents`, { minimum: 2 });
    requireFiniteNumber(band.codexRounds, `curve[${index}].codexRounds`, {
      minimum: 0,
    });
    if (
      !Number.isInteger(band.agents) ||
      !Number.isInteger(band.codexRounds) ||
      !["skip", "high", "xhigh"].includes(band.codex) ||
      band.maxScore <= previousMaximum
    ) {
      throw new Error(`invalid risk policy: curve[${index}] is malformed`);
    }
    previousMaximum = band.maxScore;
  }
  if (previousMaximum < 100) {
    throw new Error("invalid risk policy: curve must cover score 100");
  }
}

function validateScoreConfig(cfg) {
  if (!["autonomous", "human-required"].includes(cfg?.mergeAuthority)) {
    throw new Error(
      "mergeAuthority must be either 'autonomous' or 'human-required'",
    );
  }
  for (const name of ["securityFloor", "humanFloor", "high", "low"]) {
    requirePatternList(cfg?.[name], name);
  }
  for (const name of ["securityFloor", "high", "medium", "low"]) {
    requireFiniteNumber(cfg?.base?.[name], `base.${name}`, { minimum: 0 });
  }
  requireFiniteNumber(cfg?.mechanicalDelta, "mechanicalDelta");
  for (const name of [
    "linesForSmall",
    "linesForLarge",
    "maxAdd",
    "capMechanicalAboveLines",
  ]) {
    requireFiniteNumber(cfg?.magnitude?.[name], `magnitude.${name}`, {
      minimum: 0,
    });
  }
  requireFiniteNumber(cfg?.codexForceFloor, "codexForceFloor", { minimum: 0 });
  validateCurve(cfg?.curve);
  return cfg;
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function loadConfig(repoRoot) {
  const p = path.join(repoRoot || process.cwd(), "harness-config.json");
  if (!fs.existsSync(p)) return validateScoreConfig(DEFAULTS);
  const repoCfg = parseConfigJson(fs.readFileSync(p, "utf8"), p);
  if (!isPlainObject(repoCfg)) {
    throw new Error(
      "invalid risk policy: harness-config root must be an object",
    );
  }
  if (!Object.hasOwn(repoCfg, "scorePolicy")) {
    return validateScoreConfig(DEFAULTS);
  }
  if (!isPlainObject(repoCfg.scorePolicy)) {
    throw new Error("invalid risk policy: scorePolicy must be an object");
  }
  const cfg = deepMerge(DEFAULTS, repoCfg.scorePolicy);
  cfg.securityFloor = effectiveSecurityFloor(cfg);
  cfg.humanFloor = additiveFloorPatterns(DEFAULTS.humanFloor, cfg.humanFloor);
  cfg.base = {
    ...cfg.base,
    securityFloor: securityFloorScore(cfg),
  };
  return validateScoreConfig(cfg);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function score({
  base = null,
  gitRunner = defaultGitRunner,
  config = null,
  repoRoot = null,
  taskType: persistedTaskType = null,
} = {}) {
  const cfg = validateScoreConfig(config || loadConfig(repoRoot));
  const resolved = resolveBase(gitRunner, base);

  // Fail CLOSED when no durable base could be found. Scoring a change against an
  // unknown base can only produce a misleadingly LOW number (a truncated diff),
  // which would under-provision review and skip break-glass. Instead score
  // maximum risk with an explicit reason so the operator sees why.
  if (resolved.unresolved) {
    const knobs = scoreToKnobs(100, cfg);
    return {
      riskScore: 100,
      mergeAuthority: cfg.mergeAuthority,
      taskType: "unknown",
      changeNature: "unknown",
      diffStats: { files: 0, lines: 0 },
      reasons: [
        "risk base unresolved (no --base, no GITHUB_BASE_REF, no upstream, no origin/main) — scoring maximum risk fail-closed; pass --base or fetch the base ref for an accurate score",
      ],
      knobs,
      base: null,
      baseUnresolved: true,
    };
  }

  const resolvedBase = resolved.ref;
  const { descriptors, diffStats, mergeBase } = collectDescriptors(
    resolvedBase,
    gitRunner,
  );
  if (persistedTaskType !== null && !TASK_TYPES.has(persistedTaskType)) {
    throw new Error(`invalid persisted task type '${persistedTaskType}'`);
  }
  const taskType =
    persistedTaskType ||
    classifyTaskType(descriptors, collectCommitSubjects(mergeBase, gitRunner));
  const scored = applyTaskTypeFloor(
    computeScore(descriptors, diffStats, cfg),
    taskType,
    cfg,
  );
  const knobs = scoreToKnobs(scored.riskScore, cfg);
  return {
    ...scored,
    mergeAuthority: cfg.mergeAuthority,
    taskType,
    diffStats,
    knobs,
    base: resolvedBase,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { base: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base" && argv[i + 1]) out.base = argv[++i];
    else if (argv[i] === "--json") out.json = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = score({ base: args.base });

  const gh = process.env.GITHUB_OUTPUT;
  if (gh) {
    const lines = [
      `riskScore=${result.riskScore}`,
      `taskType=${result.taskType}`,
      `changeNature=${result.changeNature}`,
      `diffFiles=${result.diffStats.files}`,
      `diffLines=${result.diffStats.lines}`,
      `agents=${result.knobs.agents}`,
      `codex=${result.knobs.codex}`,
      `codexRounds=${result.knobs.codexRounds}`,
    ];
    fs.appendFileSync(gh, lines.join("\n") + "\n");
  }

  if (args.json || !gh) {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (require.main === module) main();

/**
 * True when ANY changed file matches the legacy manual-governance subset
 * (`humanFloor`). `quality-authorize-merge.sh` evaluates this only when the
 * persisted policy explicitly selects human-required merge authority. `files`
 * is repo-relative paths; `cfg` is the effective scoring config.
 */
function touchesHumanFloor(files, cfg = DEFAULTS) {
  // Case-INSENSITIVE, normalized matching: an attacker/agent must not evade the
  // floor by casing (AUTH/, .PEM), a leading ./, or backslash separators. We
  // lowercase both the path and the patterns and normalize separators before
  // matching, rather than changing the shared matchesPattern (which tier scoring
  // also uses) — keeping this hardening local to the human floor.
  // The built-in list is an immutable security minimum. Configuration comes
  // from the reviewed checkout, so treating cfg.humanFloor as a replacement
  // would let a PR commit `humanFloor: []` and authorize its own sensitive diff.
  // Repository policy can only add stricter patterns.
  const patterns = additiveFloorPatterns(DEFAULTS.humanFloor, cfg?.humanFloor);
  return (files || []).some(
    (file) =>
      hasControlCharacters(file) ||
      matchesPattern(normalizeFloorPath(file), patterns),
  );
}

module.exports = {
  score,
  computeScore,
  classifyChangeNature,
  scoreToKnobs,
  classifyTaskType,
  manifestRisk,
  matchesPattern,
  globToRegExp,
  fileIsMechanical,
  workflowDiffIsRiskBearing,
  descriptorBaseRisk,
  isForcedLogic,
  matchesSecurityFloor,
  touchesHumanFloor,
  loadConfig,
  deepMerge,
  parseNameStatusZ,
  parseNumstatZ,
  DEFAULTS,
  CRITICAL_RISK_SCORE,
};
