#!/usr/bin/env node
"use strict";

/**
 * risk-score.js — kit-native review-depth scorer.
 *
 * Computes a 0–100 risk score for the current change from `git diff` alone, so
 * the quality skill can scale machine-review depth (Claude agent count, Codex
 * effort, Codex rounds) proportionally. Works in ANY repo with zero per-repo
 * setup: built-in defaults cover the common cases; a repo's harness-config.json
 * (scorePolicy/securityFloor) is merged over the defaults when present.
 *
 * Why this exists: review is machine-only (Claude finds, Codex verifies) on
 * flat-rate subscriptions, so the real cost is wall-clock. Running the full
 * 6-agent + Codex-adversarial pass on a one-line comment change is pure waste;
 * skipping depth on a security-surface change is dangerous. The score scales
 * depth between those — but never to zero (there is no human floor).
 *
 * Design constraints:
 *   - Zero runtime dependencies (must run in 23 repos with no node_modules).
 *   - Deterministic + explainable (every score ships a `reasons[]` trail).
 *   - Conservative: mechanical/size heuristics can only LOWER score off a
 *     non-sensitive base, never below the security floor; magnitude only raises.
 *
 * Output (JSON to stdout, or GITHUB_OUTPUT lines when that env is set):
 *   { riskScore, changeNature, diffStats, reasons, knobs }
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Built-in defaults (overridable via harness-config.json: scorePolicy)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // Path → base score. First matching tier wins (most-sensitive first).
  // Security surface pins a high floor regardless of change nature.
  securityFloor: [
    "**/.github/workflows/**",
    "**/.husky/**",
    "**/*.husky/**",
    "**/auth/**",
    "**/licensing*.*",
    "**/license*.*",
    "**/*secret*",
    "**/*credential*",
    "**/deploy*.*",
    "**/*deploy-*.*",
    "**/install.sh",
    "**/webhook*.*",
    "**/middleware.*",
    "**/*.pem",
    "**/*.key",
    "**/.env*",
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
    { maxScore: 75, agents: 6, codex: "high", codexRounds: 1 },
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
  return new RegExp("^" + re + "$");
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

// ---------------------------------------------------------------------------
// git helpers (injectable runner for tests)
// ---------------------------------------------------------------------------

function defaultGitRunner(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function resolveBase(gitRunner, baseArg) {
  if (baseArg) return baseArg;
  if (process.env.GITHUB_BASE_REF)
    return `origin/${process.env.GITHUB_BASE_REF}`;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    try {
      gitRunner(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      return ref;
    } catch {
      /* try next */
    }
  }
  return "HEAD~1"; // last resort: previous commit
}

// ---------------------------------------------------------------------------
// Change-nature classification (mechanical vs logic)
// ---------------------------------------------------------------------------

function isCommentWhitespaceSafeLang(file) {
  return /\.(js|jsx|ts|tsx|mjs|cjs|css|scss|md)$/.test(file);
}

function isDirectiveComment(content) {
  return /@ts-(nocheck|ignore|expect-error)|eslint-(disable|enable)|istanbul ignore|c8 ignore|prettier-ignore|v8 ignore|@preserve|@license|webpack|sourceMappingURL/.test(
    content,
  );
}

function isWholeLineInertComment(content, file) {
  if (/\.md$/.test(file)) return /^<!--.*-->$/.test(content);
  if (/\.css$/.test(file)) return /^\/\*.*\*\/$/.test(content);
  if (/\.(js|jsx|ts|tsx|mjs|cjs|scss)$/.test(file)) {
    if (content.startsWith("//")) return true;
    return /^\/\*.*\*\/$/.test(content);
  }
  return false;
}

function patchIsCommentWhitespaceOnly(file, patch) {
  if (!isCommentWhitespaceSafeLang(file) || !patch) return false;
  let sawChange = false;
  for (const line of patch.split("\n")) {
    if (/^[+-]{3}\s/.test(line)) continue;
    if (line[0] !== "+" && line[0] !== "-") continue;
    const content = line.slice(1).trim();
    if (content === "") continue;
    if (!isWholeLineInertComment(content, file)) return false;
    if (isDirectiveComment(content)) return false;
    sawChange = true;
  }
  return sawChange;
}

function patchIsAdditiveOnly(patch) {
  if (!patch) return false;
  let sawAdd = false;
  for (const line of patch.split("\n")) {
    if (/^[+-]{3}\s/.test(line)) continue;
    if (line[0] === "-") return false;
    if (line[0] === "+") sawAdd = true;
  }
  return sawAdd;
}

function isTestPath(file) {
  return (
    /(^|\/)(__tests__|tests?)\//.test(file) ||
    /\.(test|spec)\.[jt]sx?$/.test(file)
  );
}

function isExecutablePromptSurface(file) {
  const base = file.split("/").pop();
  if (base === "CLAUDE.md" || base === "AGENTS.md") return true;
  return /(^|\/)(commands|skills|agents)\//.test(file);
}

// A file's change can never be "mechanical" under these conditions.
function isForcedLogic(file, status, isBinary) {
  if (["D", "R", "C", "T"].includes(status)) return true;
  if (isBinary) return true;
  if (/(^|\/)\.github\/workflows\//.test(file)) return true;
  if (isExecutablePromptSurface(file)) return true;
  return false;
}

function fileIsMechanical(file, status, patch, floorPaths) {
  if (matchesPattern(file, floorPaths)) return false; // floor files are never mechanical
  const testRuleAllowed = isTestPath(file);
  return (
    (testRuleAllowed && status === "A") ||
    (testRuleAllowed && patchIsAdditiveOnly(patch)) ||
    patchIsCommentWhitespaceOnly(file, patch)
  );
}

/**
 * Classify the whole changeset. Mechanical requires EVERY file mechanical and
 * no forced-logic condition. One logic file taints the whole set.
 */
function classifyChangeNature(descriptors, floorPaths) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return "logic";
  for (const d of descriptors) {
    if (isForcedLogic(d.file, d.status, d.isBinary)) return "logic";
    if (!fileIsMechanical(d.file, d.status, d.patch, floorPaths))
      return "logic";
  }
  return "mechanical";
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
    "--no-renames",
    `${mergeBase}...HEAD`,
  ]);
  const numstat = safeGit(gitRunner, [
    "diff",
    "--numstat",
    "--no-renames",
    `${mergeBase}...HEAD`,
  ]);

  const statusByFile = new Map();
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const letter = parts[0][0];
    const file = parts[parts.length - 1];
    statusByFile.set(file, {
      status: letter,
      baseFile: ["R", "C"].includes(letter) ? parts[1] : file,
    });
  }

  let totalLines = 0;
  const descriptors = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [add, del, file] = line.split("\t");
    const isBinary = add === "-" && del === "-";
    const lines = isBinary
      ? 0
      : (parseInt(add, 10) || 0) + (parseInt(del, 10) || 0);
    totalLines += lines;
    const statusInfo = statusByFile.get(file) || {
      status: "M",
      baseFile: file,
    };
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
    diffStats: { files: descriptors.length, lines: totalLines },
  };
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
  if (matchesPattern(file, cfg.securityFloor)) return cfg.base.securityFloor;
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
  if (spec.startsWith("workspace:")) {
    return isPlainRegistrySelector(spec.slice("workspace:".length));
  }
  if (spec.startsWith("npm:")) {
    const separator = spec.lastIndexOf("@");
    return (
      separator > "npm:".length &&
      isPlainRegistrySelector(spec.slice(separator + 1))
    );
  }
  return isPlainRegistrySelector(spec);
}

function isPlainRegistrySelector(spec) {
  if (!spec || spec.startsWith(".")) return false;
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

function descriptorBaseRisk(descriptor, cfg) {
  if (
    matchesPattern(descriptor.file, ["**/package.json"]) &&
    !matchesPattern(descriptor.file, cfg.securityFloor)
  ) {
    return manifestRisk(descriptor, cfg);
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
  const touchesFloor = descriptors.some((d) =>
    matchesPattern(d.file, cfg.securityFloor),
  );
  reasons.push(`path base ${base} (most-sensitive: ${topFile || "n/a"})`);
  if (topReason) reasons.push(topReason);

  const changeNature = classifyChangeNature(descriptors, cfg.securityFloor);
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
  if (touchesFloor && score < cfg.base.securityFloor) {
    score = cfg.base.securityFloor;
    reasons.push(`pinned to security floor ${cfg.base.securityFloor}`);
  }

  score = Math.max(0, Math.min(100, score));
  return { riskScore: score, changeNature, reasons };
}

function scoreToKnobs(score, cfg) {
  const band =
    cfg.curve.find((b) => score <= b.maxScore) ||
    cfg.curve[cfg.curve.length - 1];
  let codex = band.codex;
  let codexRounds = band.codexRounds;
  if (score >= cfg.codexForceFloor && codex === "skip") {
    codex = "high";
    codexRounds = 1;
  }
  return { agents: band.agents, codex, codexRounds };
}

// ---------------------------------------------------------------------------
// Config merge
// ---------------------------------------------------------------------------

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object"
    ) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function loadConfig(repoRoot) {
  let cfg = DEFAULTS;
  try {
    const p = path.join(repoRoot || process.cwd(), "harness-config.json");
    if (fs.existsSync(p)) {
      const repoCfg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (repoCfg.scorePolicy) cfg = deepMerge(DEFAULTS, repoCfg.scorePolicy);
    }
  } catch {
    /* defaults */
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function score({
  base = null,
  gitRunner = defaultGitRunner,
  config = null,
  repoRoot = null,
} = {}) {
  const cfg = config || loadConfig(repoRoot);
  const resolvedBase = resolveBase(gitRunner, base);
  const { descriptors, diffStats } = collectDescriptors(
    resolvedBase,
    gitRunner,
  );
  const { riskScore, changeNature, reasons } = computeScore(
    descriptors,
    diffStats,
    cfg,
  );
  const knobs = scoreToKnobs(riskScore, cfg);
  return {
    riskScore,
    changeNature,
    diffStats,
    reasons,
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

module.exports = {
  score,
  computeScore,
  classifyChangeNature,
  scoreToKnobs,
  manifestRisk,
  matchesPattern,
  globToRegExp,
  fileIsMechanical,
  isForcedLogic,
  loadConfig,
  deepMerge,
  DEFAULTS,
};
