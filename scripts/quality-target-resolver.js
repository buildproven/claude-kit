#!/usr/bin/env node

/**
 * Quality Target Resolver
 *
 * Parses the args passed to `/bs:quality` (especially with `--merge`) and
 * resolves which checkout / branch / PR should be audited.
 *
 * Bug being fixed:
 *   When `/bs:quality --merge` was invoked with PR context in the natural-
 *   language args (PR number, branch name, or worktree path), the skill
 *   ignored that context and audited the primary checkout's uncommitted
 *   changes — producing irrelevant reports.
 *
 * Resolution priority (highest first):
 *   1. Explicit PR number  — `#NNN`, `PR NNN`, `pr#NNN`, `pull/NNN`
 *   2. Explicit branch name — `--branch <name>` flag OR a token that looks
 *      like a remote branch ref (contains `/`, e.g. `codex/foo`, `feat/bar`).
 *   3. Worktree path — `--target-dir <path>` (existing convention) OR any
 *      absolute path arg that is an existing directory.
 *   4. cwd is a non-primary worktree — audit cwd's diff vs base.
 *   5. Fallback: primary checkout (loud warning).
 *
 * `--merge` mode REFUSES to fall through to (5). If --merge is set and no
 * target can be resolved, the resolver returns a `merge_refuse` outcome and
 * the skill must hard-error.
 *
 * Pure functions exported for unit testing — see
 *   scripts/__tests__/quality-target-resolution.test.js
 */

"use strict";

const PR_PATTERNS = [
  /(?:^|\s)#(\d+)(?:\s|$)/i, // " #410 "
  /(?:^|\s)pr\s*#?\s*(\d+)(?:\s|$)/i, // "PR 410", "pr#410", "pr 410"
  /(?:^|\s)pull[/#-](\d+)(?:\s|$)/i, // "pull/410", "pull-410"
];

// A token "looks like" a branch when it has a slash that isn't a filesystem
// path. We accept the common prefixes (codex/, feat/, fix/, chore/, docs/,
// refactor/, test/, perf/, build/, ci/, hotfix/, release/, dependabot/) and
// any prefix matching identifier-like chars before the first slash.
const BRANCH_REGEX = /^(?!\/|~|\.\/|\.\.\/)([A-Za-z][\w.-]*\/[\w./-]+)$/;

const EXPLICIT_PR_FLAG = new Set(["--pr", "--pull", "--pull-request"]);
const EXPLICIT_BRANCH_FLAG = new Set(["--branch", "--head", "--head-ref"]);
const EXPLICIT_PATH_FLAG = new Set(["--target-dir", "--target", "--worktree"]);

/**
 * Parse args (string or array) into a structured object.
 *
 * @param {string|string[]} rawArgs
 * @returns {{
 *   merge: boolean,
 *   pr: number | null,
 *   branch: string | null,
 *   path: string | null,
 *   source: 'pr-flag' | 'pr-pattern' | 'pr-bare' | 'branch-flag' | 'branch-pattern' | 'path-flag' | 'path-pattern' | 'none',
 *   tokens: string[],
 * }}
 */
// --- parser helpers (extracted to keep cyclomatic complexity per function low) ---

function extractFlagValue(tokens, i, flagSet) {
  const tok = tokens[i];
  const next = tokens[i + 1];
  if (flagSet.has(tok) && next && !next.startsWith("-")) {
    return next;
  }
  for (const f of flagSet) {
    if (tok.startsWith(`${f}=`)) {
      const val = tok.split("=")[1];
      if (val) return val;
    }
  }
  return null;
}

function setIfUnset(result, field, value, source) {
  if (result[field] === null) {
    result[field] = value;
    if (result.source === "none") result.source = source;
  }
}

function applyExplicitFlags(tokens, result) {
  for (let i = 0; i < tokens.length; i += 1) {
    const prVal = extractFlagValue(tokens, i, EXPLICIT_PR_FLAG);
    if (prVal !== null && /^\d+$/.test(prVal)) {
      result.pr = Number(prVal);
      result.source = "pr-flag";
    }

    const branchVal = extractFlagValue(tokens, i, EXPLICIT_BRANCH_FLAG);
    if (branchVal !== null)
      setIfUnset(result, "branch", branchVal, "branch-flag");

    const pathVal = extractFlagValue(tokens, i, EXPLICIT_PATH_FLAG);
    if (pathVal !== null) setIfUnset(result, "path", pathVal, "path-flag");
  }
}

function applyPrPattern(text, result) {
  if (result.pr !== null) return;
  for (const re of PR_PATTERNS) {
    const m = text.match(re);
    if (m) {
      result.pr = Number(m[1]);
      if (result.source === "none") result.source = "pr-pattern";
      return;
    }
  }
}

const PATH_PREFIXES = ["/", "~", "./", "../"];
const FILE_EXT_RE = /\.(js|ts|tsx|jsx|md|json|sh|py|yml|yaml|toml)$/i;

function looksLikePath(tok) {
  return PATH_PREFIXES.some((p) => tok.startsWith(p));
}

function applyBranchPattern(tokens, result) {
  if (result.branch !== null) return;
  for (const tok of tokens) {
    if (tok.startsWith("-")) continue;
    if (looksLikePath(tok)) continue;
    if (tok === result.path) continue;
    if (FILE_EXT_RE.test(tok)) continue;
    const m = tok.match(BRANCH_REGEX);
    if (m) {
      result.branch = m[1];
      if (result.source === "none") result.source = "branch-pattern";
      return;
    }
  }
}

function applyPathPattern(tokens, result) {
  if (result.path !== null) return;
  for (const tok of tokens) {
    if (tok.startsWith("-")) continue;
    if (tok.startsWith("/") || tok.startsWith("~")) {
      result.path = tok;
      if (result.source === "none") result.source = "path-pattern";
      return;
    }
  }
}

function detectMerge(tokens) {
  return tokens.some((t) => t === "--merge" || t.startsWith("--merge="));
}

// A bare positive integer (e.g. `--merge 558`) is a PR number. The PR_PATTERNS
// above only match `#558`/`pr 558`/`pull/558`, so `/bs:quality --merge 558` —
// exactly how a bare PR number arrives from the slash command — resolved to
// nothing and fell through to merge-refuse / a silent cwd audit (2026-07-14).
// Runs LAST, only under --merge, and only if no PR was already claimed, so it
// can never shadow an explicit flag, a `#`-prefixed PR, a branch, or a path.
function applyBarePrToken(tokens, result) {
  if (result.pr !== null || !result.merge) return;
  for (const tok of tokens) {
    if (tok.startsWith("-")) continue;
    if (tok === result.branch || tok === result.path) continue;
    if (/^\d+$/.test(tok)) {
      result.pr = Number(tok);
      if (result.source === "none") result.source = "pr-bare";
      return;
    }
  }
}

function parseArgs(rawArgs) {
  const tokens = normalizeTokens(rawArgs);
  const text = tokens.join(" ");

  const result = {
    merge: detectMerge(tokens),
    pr: null,
    branch: null,
    path: null,
    source: "none",
    tokens,
  };

  applyExplicitFlags(tokens, result);
  applyPrPattern(text, result);
  applyBranchPattern(tokens, result);
  applyPathPattern(tokens, result);
  applyBarePrToken(tokens, result);

  return result;
}

function normalizeTokens(rawArgs) {
  if (Array.isArray(rawArgs)) {
    return rawArgs.filter((t) => typeof t === "string" && t.length > 0);
  }
  if (typeof rawArgs !== "string") return [];
  // Simple whitespace split is fine — these args come from a slash command,
  // not a shell. We don't need to honor quoted strings.
  return rawArgs.trim().split(/\s+/).filter(Boolean);
}

/**
 * Resolve a target into an actionable plan. Pure-ish: takes injectable
 * helpers so it can be unit-tested without touching git / gh / fs.
 *
 * @param {ReturnType<typeof parseArgs>} parsed
 * @param {object} ctx
 * @param {string} ctx.cwd               - process.cwd()
 * @param {string|null} ctx.primaryCheckout
 * @param {(branch: string) => string|null} ctx.findWorktreeForBranch
 * @param {(p: string) => boolean} ctx.dirExists
 * @param {(pr: number) => { headRefName: string } | null} ctx.lookupPr
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   targetPath?: string,
 *   targetBranch?: string,
 *   targetPr?: number,
 *   resolution: 'pr' | 'branch' | 'path' | 'cwd-worktree' | 'primary-fallback' | 'merge-refuse',
 *   warnings: string[],
 * }}
 */
// --- resolver helpers (extracted to keep complexity per function low) ---

function resolveByPr(parsed, ctx) {
  const { findWorktreeForBranch, dirExists, lookupPr } = ctx;
  const pr = lookupPr ? lookupPr(parsed.pr) : null;
  if (!pr || !pr.headRefName) {
    return {
      ok: false,
      reason: `Could not resolve PR #${parsed.pr} (gh pr view failed or returned no headRefName).`,
      resolution: "pr",
      warnings: [],
      targetPr: parsed.pr,
    };
  }
  const wtPath = findWorktreeForBranch
    ? findWorktreeForBranch(pr.headRefName)
    : null;
  if (wtPath && dirExists(wtPath)) {
    return {
      ok: true,
      targetPath: wtPath,
      targetBranch: pr.headRefName,
      targetPr: parsed.pr,
      resolution: "pr",
      warnings: [],
    };
  }
  return {
    ok: true,
    targetBranch: pr.headRefName,
    targetPr: parsed.pr,
    resolution: "pr",
    warnings: [
      `No local worktree found for branch '${pr.headRefName}'. Skill must materialize one before auditing.`,
    ],
  };
}

function resolveByBranch(parsed, ctx) {
  const { findWorktreeForBranch, dirExists } = ctx;
  const wtPath = findWorktreeForBranch
    ? findWorktreeForBranch(parsed.branch)
    : null;
  if (wtPath && dirExists(wtPath)) {
    return {
      ok: true,
      targetPath: wtPath,
      targetBranch: parsed.branch,
      resolution: "branch",
      warnings: [],
    };
  }
  return {
    ok: true,
    targetBranch: parsed.branch,
    resolution: "branch",
    warnings: [
      `No local worktree found for branch '${parsed.branch}'. Skill must materialize one before auditing.`,
    ],
  };
}

function resolveByPath(parsed, ctx) {
  const expanded = parsed.path.replace(/^~(?=$|\/)/, process.env.HOME || "~");
  if (ctx.dirExists(expanded)) {
    return { ok: true, targetPath: expanded, resolution: "path", warnings: [] };
  }
  return {
    ok: false,
    reason: `Path arg does not exist: ${expanded}`,
    resolution: "path",
    warnings: [],
  };
}

function resolveTarget(parsed, ctx) {
  if (parsed.pr !== null) return resolveByPr(parsed, ctx);
  if (parsed.branch) return resolveByBranch(parsed, ctx);
  if (parsed.path) return resolveByPath(parsed, ctx);

  // 4. cwd is a non-primary worktree → audit it.
  if (ctx.primaryCheckout && ctx.cwd && ctx.cwd !== ctx.primaryCheckout) {
    return {
      ok: true,
      targetPath: ctx.cwd,
      resolution: "cwd-worktree",
      warnings: [],
    };
  }

  // 5. Primary checkout fallback. NEVER allowed under --merge.
  if (parsed.merge) {
    return {
      ok: false,
      reason:
        "--merge requires an explicit PR#, branch name, or worktree path. " +
        "Refusing to silently audit the primary checkout in merge mode.",
      resolution: "merge-refuse",
      warnings: [],
    };
  }

  return {
    ok: true,
    targetPath: ctx.primaryCheckout || ctx.cwd,
    resolution: "primary-fallback",
    warnings: [
      "No target specified — auditing primary checkout. " +
        "Pass --target-dir, a branch name, or #<PR> to be explicit.",
    ],
  };
}

module.exports = {
  parseArgs,
  resolveTarget,
  // exposed for completeness / tests
  PR_PATTERNS,
  BRANCH_REGEX,
};

/* istanbul ignore next */
if (require.main === module) {
  // CLI mode for the SKILL.md shell preamble. Invocation:
  //   QUALITY_CWD=<cwd> QUALITY_PRIMARY_CHECKOUT=<primary> \
  //     node quality-target-resolver.js --cli [original args...]
  //
  // Emits a JSON object matching resolveTarget()'s return shape.
  const argvIdx = process.argv.indexOf("--cli");
  const passthrough =
    argvIdx >= 0 ? process.argv.slice(argvIdx + 1) : process.argv.slice(2);

  // Use execFileSync (not exec) — no shell, no injection.
  const { execFileSync } = require("child_process");
  const fs = require("fs");

  const runGit = (args) => {
    try {
      return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return "";
    }
  };

  const dirExists = (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  const findWorktreeForBranch = (branch) => {
    const out = runGit(["worktree", "list", "--porcelain"]);
    if (!out) return null;
    const lines = out.split("\n");
    let currentPath = null;
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length).trim();
      } else if (line === `branch refs/heads/${branch}`) {
        return currentPath;
      } else if (line === "") {
        currentPath = null;
      }
    }
    return null;
  };

  const lookupPr = (n) => {
    if (!Number.isInteger(n) || n <= 0) return null;
    try {
      const out = execFileSync(
        "gh",
        ["pr", "view", String(n), "--json", "headRefName,baseRefName"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const parsed = JSON.parse(out);
      if (parsed && parsed.headRefName) return parsed;
      return null;
    } catch {
      return null;
    }
  };

  const parsed = parseArgs(passthrough);
  const result = resolveTarget(parsed, {
    cwd: process.env.QUALITY_CWD || process.cwd(),
    primaryCheckout: process.env.QUALITY_PRIMARY_CHECKOUT || null,
    findWorktreeForBranch,
    dirExists,
    lookupPr,
  });

  process.stdout.write(JSON.stringify(result) + "\n");
  // Always exit 0 — caller inspects .ok in the JSON payload.
  process.exit(0);
}
