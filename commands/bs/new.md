---
model: opus
name: bs:new
description: Create new project with QA Architect quality automation (framework-agnostic)
argument-hint: "<project-name> [--path dir] → new project with QA Architect"
category: project
tags: [setup, init, quality, qa-architect]
---

## Step 1 — Persist args so the forked skill can read them (REQUIRED)

The `new` skill runs in a forked Claude context that does NOT reliably
inherit this turn's `$ARGUMENTS` (same gap documented in `commands/bs/quality.md`).
A dropped `project-name`/`--path` silently falls through to the skill's
interactive prompts instead of pre-filling them — bridge the gap with a
tempfile, exactly like `/bs:quality` does:

```bash
NEW_ARGS_DIR=$(mktemp -d -t bs-new-args 2>/dev/null \
  || mktemp -d "${TMPDIR:-/tmp}/bs-new-args.XXXXXX")
NEW_ARGS_FILE="$NEW_ARGS_DIR/args.txt"
printf '%s\n' "$ARGUMENTS" > "$NEW_ARGS_FILE"
echo "NEW_ARGS_FILE=$NEW_ARGS_FILE"
```

## Step 2 — Invoke the new skill

Call the `Skill` tool with `skill="new"` and
`args="--args-file <NEW_ARGS_FILE> $ARGUMENTS"` (substitute the path
captured above). The skill's Step 1 reads `--args-file` first when present,
falling back to `$ARGUMENTS` for backwards compatibility.
