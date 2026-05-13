---
name: bs:quality
description: Autonomous quality loop with configurable thoroughness (95% or 98%). Runs lint, tests, build, security scans, and specialized quality agents. Auto-fixes issues and creates PRs.
argument-hint: "[--level 95|98] [--scope changed|branch|all] [--merge] [--audit] [--deep] [--preflight] [--parallel] [--deploy] [--target-dir <path>]"
tags: [quality, ci, review]
category: quality
---

**Invocation args:** `$ARGUMENTS`

## Step 1 — Persist args so the forked skill can read them (REQUIRED)

The `quality` skill runs in a forked Claude context that does NOT
inherit this turn's `$ARGUMENTS`. To bridge that gap, **before
invoking the Skill tool**, write the args to a tempfile and pass its
path to the skill via `--args-file`. The skill's Step -1 reads this
file when `$@` is empty.

Run this `Bash` call first, exactly as written:

```bash
# mktemp avoids collisions under concurrent /bs:merge-train invocations.
QUALITY_ARGS_FILE=$(mktemp "${TMPDIR:-/tmp}/bs-quality-args-XXXXXX.txt")
printf '%s\n' "$ARGUMENTS" > "$QUALITY_ARGS_FILE"
echo "QUALITY_ARGS_FILE=$QUALITY_ARGS_FILE"
echo "QUALITY_ARGS=$ARGUMENTS"
```

Capture the printed `QUALITY_ARGS_FILE` path — you'll pass it to the
skill in the next step. The skill is responsible for deleting the
file once it has read the args (Step -1 of the skill).

If the skill fails to consume the file (e.g. version skew between
slash command and skill), stale files accumulate under `$TMPDIR`. The
slash command does not try to clean them up — that's the skill's
responsibility, and a periodic `find $TMPDIR -name 'bs-quality-args-*.txt' -mtime +1 -delete` cron is a reasonable
hygiene step at the user level.

## Step 2 — Invoke the quality skill

Call the `Skill` tool with:
- `skill="quality"`
- `args="--args-file <QUALITY_ARGS_FILE> $ARGUMENTS"`

(Substitute the actual path you captured in Step 1 for `<QUALITY_ARGS_FILE>`.)

The duplicated args (both in the file AND in the args string) are
intentional: belt-and-suspenders so the skill picks them up via
whichever channel survives the fork. The file is the reliable path
(persisted to disk); the args string is the fast path (works if/when
the runtime ever propagates `args` to the fork's `$@`).

If `$ARGUMENTS` is empty (no flags passed), still call the skill —
it has a sensible default (audit cwd, no merge).

**Security note:** the tempfile contains only flag-style args
(PR numbers, branch names, `--target-dir` paths). Do not let
operators pass tokens or secrets in `$ARGUMENTS` — they'd land on
disk in `$TMPDIR`. The skill rejects any arg containing `=` followed
by a value that looks like a token.

## Flag notes

- `--target-dir <path>` (alias `--target`): run the quality loop
  against the repo at `<path>` instead of the current working
  directory. Use when invoking from a forked agent context where the
  agent's `cwd` is a harness scratch directory rather than the
  worktree.
- `--args-file <path>` (added 2026-05-12): fallback channel for the
  slash-command wrapper to pass args to the forked skill. Set by
  this command automatically — operators rarely need to use it
  directly.
