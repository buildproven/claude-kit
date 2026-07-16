---
name: bs:scrub
description: "Scrub a release or audit the installed command/skill surface"
argument-hint: "[path] [opensource|sell|giveaway] | surface [--root path] [--fix]"
tags: [release, security, opensource]
category: release
---

**Invocation args:** `$ARGUMENTS`

## Surface mode

If the first argument is `surface`, do not enter the destructive release scrub.
Resolve `scripts/surface-audit.js` through the installed kit root and run:

```bash
node ~/.claude/scripts/surface-audit.js --root="${TARGET_ROOT:-$PWD}" --command-budget=24
```

`--root <path>` overrides the target. Without `--fix`, report:

- user-visible command count versus budget;
- registered skill count;
- thin wrappers;
- commands without same-name skills;
- direct provider executable references.

With `--fix`, use the report to make a reviewed branch that consolidates
wrappers into modes, marks background-only Claude skills
`user-invocable: false`, and moves Codex-internal material beneath retained
skills as references. Never remove a skill solely because its name did not
appear in text history; histories contain examples and prompt bodies, not
authoritative invocation telemetry.

Stop after surface mode. The remaining steps apply only to release scrub.

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
