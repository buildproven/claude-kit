---
name: bs:scrub
description: "Scrub/clean a project for release: open source, giveaway, or commercial sale"
argument-hint: "[path] [opensource|sell|giveaway]"
tags: [release, security, opensource]
category: release
---

**Invocation args:** `$ARGUMENTS`

## Step 1 — Persist args so the forked skill can read them (REQUIRED)

The `scrub` skill runs in a forked Claude context that does NOT reliably
inherit this turn's `$ARGUMENTS` (same gap documented in `commands/bs/quality.md`).
Because `scrub` performs destructive, in-place edits (secret removal, license
rewrites) on the target path, a dropped `path` argument means the skill
silently falls back to its cwd default and can scrub the wrong project. Bridge
the gap with a tempfile, exactly like `/bs:quality` does:

```bash
SCRUB_ARGS_DIR=$(mktemp -d -t bs-scrub-args 2>/dev/null \
  || mktemp -d "${TMPDIR:-/tmp}/bs-scrub-args.XXXXXX")
SCRUB_ARGS_FILE="$SCRUB_ARGS_DIR/args.txt"
printf '%s\n' "$ARGUMENTS" > "$SCRUB_ARGS_FILE"
echo "SCRUB_ARGS_FILE=$SCRUB_ARGS_FILE"
```

## Step 2 — Invoke the scrub skill

Call the `Skill` tool with `skill="scrub"` and
`args="--args-file <SCRUB_ARGS_FILE> $ARGUMENTS"` (substitute the path
captured above). The skill's Start section reads `--args-file` first when
present, falling back to `$ARGUMENTS` for backwards compatibility.

The skill handles three release modes (`opensource`, `giveaway`, `sell`) with shared security/privacy phases and mode-specific documentation generation. If no mode is provided, it will prompt.
