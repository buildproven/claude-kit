"use strict";

/**
 * risk-change-nature.js — shared change-nature classification primitives.
 *
 * SINGLE SOURCE OF TRUTH for the "is this change MECHANICAL or LOGIC?" heuristics
 * that were previously DUPLICATED (and had DRIFTED) between:
 *   - F1: core/scripts/risk-score.js       (kit numeric scorer)
 *   - F2: scripts/risk-policy-gate.js       (setup CI merge gate)
 *
 * Both files now require these pure predicates instead of keeping local copies.
 * The classifier stays engine-agnostic: the glob `matchesPattern` matcher AND the
 * per-repo `fileIsMechanical` sub-rule set are INJECTED, never hardcoded here —
 * F1 has a plain mechanical rule set, F2 adds dep-version-bump + generated-path
 * rules, and neither glob engine (F1's globToRegExp / F2's placeholder-swap) is
 * baked in. Zero runtime dependencies (must run in repos with no node_modules).
 *
 * DRIFT RESOLUTIONS applied while extracting (safer/correct variant chosen):
 *   (a) isDirectiveComment: adopted F2's `__PURE__` — a `#__PURE__` block
 *       annotation IS a build directive, not inert. F1 omitted it (a latent hole).
 *   (b) isExecutablePromptSurface: adopted F1's nested-matching regex
 *       /(^|\/)(commands|skills|agents)\//. F2's root-anchored /^(commands|…)\//
 *       would MISS a nested `x/commands/foo.md` and wrongly treat an executable
 *       prompt surface as mechanical.
 *   (c) isDirectiveComment shape: unified to ONE combined regex (F1's style)
 *       carrying the FULL union of BOTH files' directive tokens, instead of F2's
 *       seven split .test() calls.
 */

// A comment that changes TOOLING/BUILD behavior — NOT inert. Downgrading one of
// these would hide a real safety/correctness change (Codex round-2 finding).
// DRIFT (a)+(c): single combined regex, includes `__PURE__` (from F2). Union of
// every directive token that appeared in either F1 or F2.
function isDirectiveComment(content) {
  return /@ts-(nocheck|ignore|expect-error)|eslint-(disable|enable)|istanbul ignore|c8 ignore|prettier-ignore|v8 ignore|@preserve|@license|webpack|sourceMappingURL|__PURE__/.test(
    content,
  );
}

// Languages where comment/whitespace edits are NON-semantic enough to treat as
// mechanical. Deliberately conservative — excludes YAML and shell (whitespace/
// indentation can change meaning) AND json (JSON has no comments; a `//` line
// makes a config unparseable, so it's a real change, not inert).
function isCommentWhitespaceSafeLang(file) {
  return /\.(js|jsx|ts|tsx|mjs|cjs|css|scss|md)$/.test(file);
}

// Is the ENTIRE trimmed line an inert comment? Not just "starts with a comment"
// — `/* x */ process.exit(0)` starts with `/*` but has trailing code (Codex
// round-3). We require the whole line to be consumed by the comment:
//   - `// …`        full-line comment (rest of line is comment by definition)
//   - `/* … */`     a SINGLE-LINE block fully closed, nothing after the close
//   - `<!-- … -->`  markdown only, fully closed, nothing after
// A block/HTML opener NOT closed on the same line → not provably inert → false
// (multi-line comments are conservatively treated as logic). Bare `*` is never a
// comment (generator-method syntax). Directive comments are rejected upstream.
function isWholeLineInertComment(content, file) {
  // Comment syntax is language-specific (Codex round-4): `//` is NOT a CSS
  // comment; Markdown has only `<!-- -->`. Accept per file type, whole-line only.
  if (/\.md$/.test(file)) return /^<!--.*-->$/.test(content);
  if (/\.css$/.test(file)) return /^\/\*.*\*\/$/.test(content);
  if (/\.(js|jsx|ts|tsx|mjs|cjs|scss)$/.test(file)) {
    if (content.startsWith("//")) return true;
    return /^\/\*.*\*\/$/.test(content);
  }
  return false; // unknown type → not provably inert
}

// True only if EVERY added/removed content line is blank or a WHOLE-LINE inert
// comment for the file's language.
function patchIsCommentWhitespaceOnly(file, patch) {
  if (!isCommentWhitespaceSafeLang(file) || !patch) return false;
  let sawChange = false;
  for (const line of patch.split("\n")) {
    if (/^[+-]{3}\s/.test(line)) continue; // +++/--- file headers
    if (line[0] !== "+" && line[0] !== "-") continue;
    const content = line.slice(1).trim();
    if (content === "") continue; // pure whitespace
    if (!isWholeLineInertComment(content, file)) return false; // code present → logic
    if (isDirectiveComment(content)) return false; // tooling-affecting → logic
    sawChange = true;
  }
  return sawChange;
}

// True if a patch only ADDS content lines (no removals) — for additive-test
// detection on modified test files.
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

// Executable prompt / instruction surface: Markdown (and other) files under
// these paths are NOT inert documentation — they are agent prompts, command
// bodies, skill logic, and CLAUDE/AGENTS instruction files that the runtime
// reads and acts on. A comment-only edit to one can change agent behavior (e.g.
// an injected directive inside an HTML comment), so they must NEVER be classified
// mechanical. DRIFT (b): nested-matching (from F1) so a nested `x/commands/foo.md`
// is still caught — F2's root-anchored form would have missed it.
function isExecutablePromptSurface(file) {
  const base = file.split("/").pop();
  if (base === "CLAUDE.md" || base === "AGENTS.md") return true;
  return /(^|\/)(commands|skills|agents)\//.test(file);
}

// Forced-logic conditions (Codex round 1) — these can never be mechanical:
// deletions, renames, copies, type/mode changes, binaries, CI workflows, and
// executable prompt surfaces.
function isForcedLogic(file, status, isBinary, descriptor = {}) {
  if (["D", "C", "T"].includes(status)) return true;
  if (status === "R" && descriptor.pureRename !== true) return true;
  if (isBinary) return true;
  if (/(^|\/)\.github\/workflows\//.test(file)) return true;
  if (isExecutablePromptSurface(file)) return true;
  return false;
}

/**
 * Classify the whole changeset. Mechanical requires EVERY file to be mechanical
 * and NO forced-logic condition; one logic file (or any forced-logic condition)
 * taints the whole set to `logic`.
 *
 * Engine-agnostic by injection:
 *   descriptors            array of { file, status, isBinary, patch }
 *   opts.floorPaths        already-resolved array of floor globs (never mechanical)
 *   opts.matchesPattern    (filepath, patterns) => boolean — the repo's glob engine
 *   opts.fileIsMechanical  (file, status, patch, floorPaths) => boolean — the
 *                          repo's mechanical sub-rule set (F1 plain; F2 adds
 *                          dep-bump + generated-path). NOT hardcoded here because
 *                          the two repos legitimately diverge on what counts as a
 *                          mechanical single-file edit.
 */
function classifyChangeNature(descriptors, opts = {}) {
  const { floorPaths = [], fileIsMechanical } = opts;
  if (typeof fileIsMechanical !== "function") {
    throw new TypeError(
      "classifyChangeNature: opts.fileIsMechanical must be injected",
    );
  }
  if (!Array.isArray(descriptors) || descriptors.length === 0) return "logic";
  for (const d of descriptors) {
    if (isForcedLogic(d.file, d.status, d.isBinary, d)) return "logic";
    if (!fileIsMechanical(d.file, d.status, d.patch, floorPaths, d))
      return "logic";
  }
  return "mechanical";
}

module.exports = {
  isCommentWhitespaceSafeLang,
  isDirectiveComment,
  isWholeLineInertComment,
  patchIsCommentWhitespaceOnly,
  patchIsAdditiveOnly,
  isTestPath,
  isExecutablePromptSurface,
  isForcedLogic,
  classifyChangeNature,
};
