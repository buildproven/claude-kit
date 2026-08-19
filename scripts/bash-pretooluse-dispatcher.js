#!/usr/bin/env node

/**
 * One Bash PreToolUse entrypoint for the four safety guards.
 *
 * Ordinary commands are allowed after one JSON parse. Commands that could
 * reach a guard are delegated to the existing compatibility scripts, in their
 * historical order. Keeping those scripts intact preserves their direct test
 * seams and makes this change reversible while removing three interpreter
 * launches from the common path.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rawInput = fs.readFileSync(0, "utf8");

function deny(message) {
  process.stderr.write(`Blocked: ${message}\n`);
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(rawInput);
} catch {
  deny("Bash hook payload is invalid JSON.");
}

const command = payload?.tool_input?.command;
if (command === undefined || command === "") process.exit(0);
if (typeof command !== "string") deny("Bash command is not a string.");

const scriptDir = __dirname;
const repositoryRoot = path.resolve(scriptDir, "..", "..");

function resolveGuard(name) {
  // A private claude-setup overlay may intentionally replace a kit guard.
  // Prefer that overlay when this dispatcher is running from setup/core.
  const overlay = path.join(repositoryRoot, "scripts", name);
  if (
    path.resolve(overlay) !== path.resolve(scriptDir, name) &&
    fs.existsSync(overlay)
  ) {
    return overlay;
  }
  return path.join(scriptDir, name);
}

function hasDestructiveSyntax(value) {
  return (
    /\brm\b/.test(value) ||
    /\bfind\b/.test(value) ||
    /\bgit\b[^\n;&|(){}]*\bclean\b/.test(value) ||
    /(^|[\s;&|(){}])(?:\d*&?>|&>)/.test(value)
  );
}

const hasGit = /\bgit\b/.test(command);
const hasPush = hasGit && /\bpush\b/.test(command);
const hasCommit = hasGit && /\bcommit\b/.test(command);
const hasDestructive = hasDestructiveSyntax(command);

const guards = [];
if (hasDestructive) guards.push("block-destructive-paths.sh");
if (hasPush) guards.push("block-push-main.sh");
if (hasCommit) guards.push("block-commit-main.sh");
// branch-drift-guard owns session state for checkout/add/commit/stash and is
// therefore invoked for every git command, including ordinary status calls.
if (hasGit) guards.push("branch-drift-guard.sh");

for (const name of guards) {
  const result = spawnSync("bash", [resolveGuard(name)], {
    input: rawInput,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    deny(`could not execute ${name}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status === 2 ? 2 : 2);
  }
}

// A protected-branch push must fail at the branch policy first. Only a push
// that survives those semantic guards reaches fleet budget admission. This
// preserves the actionable root cause while still refusing an allowed direct
// push before it can create another Actions run. Quality's signed exact-head
// path invokes its own nested push after proving the local candidate.
//
// The budget check itself is scoped to pushes that can plausibly consume
// Actions minutes: this repo's (and every repo installed from this kit's)
// workflows trigger on `push: branches: [main]` and on `pull_request`, never
// on an arbitrary branch push. Pushing a brand-new topic branch to open a PR
// costs zero minutes by itself — gating it here made the FIRST push of any
// branch impossible once the budget is exhausted, with no sanctioned bypass:
// quality's own break-glass push only fires at merge time, against an
// already-open PR, so there was no way to create that PR in the first place.
// Reuse block-push-main.sh's classifier (already-parsed, shell-injection-safe
// tokenizer) rather than re-deriving "is this main/master" with a second
// regex that could drift from the guard that already ran.
if (hasPush) {
  const classifier = resolveGuard("block-push-main.sh");
  const classification = spawnSync("bash", [classifier, "--classify-only"], {
    input: rawInput,
    encoding: "utf8",
  });
  // "unknown" (unparseable command) and any execution failure fail closed —
  // budget admission still runs, same as before this change, rather than
  // silently exempting a push whose target this dispatcher could not verify.
  const isUnprotected =
    classification.status === 0 &&
    classification.stdout.trim() === "unprotected";
  if (!isUnprotected) {
    const admission = resolveGuard("ci-budget-admission.js");
    if (fs.existsSync(admission)) {
      const result = spawnSync(process.execPath, [admission], {
        encoding: "utf8",
      });
      if (result.status !== 0) {
        if (result.stderr) process.stderr.write(result.stderr);
        deny(
          "GitHub Actions minute policy denied this push; use the signed exact-head quality path.",
        );
      }
    }
  }
}

process.exit(0);
