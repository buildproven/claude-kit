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

Run this `Bash` call first, exactly as written. The portable
`mktemp -d` pattern works on both BSD (macOS) and GNU mktemp — a flat
`mktemp` with a `.txt` template suffix silently fails to expand on BSD,
producing collisions under concurrent `/bs:merge-train` invocations.

```bash
# Portable mktemp: create a unique dir, write args.txt inside.
QUALITY_ARGS_DIR=$(mktemp -d -t bs-quality-args 2>/dev/null \
  || mktemp -d "${TMPDIR:-/tmp}/bs-quality-args.XXXXXX")
QUALITY_ARGS_FILE="$QUALITY_ARGS_DIR/args.txt"
printf '%s\n' "$ARGUMENTS" > "$QUALITY_ARGS_FILE"
echo "QUALITY_ARGS_FILE=$QUALITY_ARGS_FILE"
echo "QUALITY_ARGS=$ARGUMENTS"
```

Capture the printed `QUALITY_ARGS_FILE` path — you'll pass it to the
skill in the next step. The skill is responsible for deleting the
file once it has read the args (Step -1 of the skill).

If the skill fails to consume the file (e.g. version skew between
slash command and skill), stale dirs accumulate under `$TMPDIR`. The
slash command does not try to clean them up — that's the skill's
responsibility, and a periodic `find $TMPDIR \( -type d -name 'bs-quality-args*' -o -type f -name 'bs-quality-gitroot-*.txt' \) -mtime +1 -exec rm -rf {} + 2>/dev/null` cron is a reasonable hygiene step at the user level.

The skill also writes a per-session sentinel file `${TMPDIR:-/tmp}/bs-quality-gitroot-${CLAUDE_CODE_SESSION_ID:-default}.txt`
containing the resolved git root. This is read at the top of every
downstream bash block in the skill so the working directory survives
across separate Bash tool invocations. Without it, `--target-dir` is
silently dropped beyond Step -1 (regression fixed 2026-05-14).

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
(PR numbers, branch names, `--target-dir` paths). Do not pass
tokens or secrets in `$ARGUMENTS` — they'd land on disk in `$TMPDIR`.

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
