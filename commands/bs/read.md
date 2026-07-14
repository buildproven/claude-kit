---
name: bs:read
standalone: true
description: "Read an article/post and extract actionable insights for your setup"
argument-hint: "<url> → read, analyze, propose setup improvements"
category: knowledge
---

# /bs:read - Read & Absorb

**URL:** $ARGUMENTS

Read an article, blog post, or technical write-up and extract actionable insights that could improve the user's Claude Code setup, workflows, or development approach.

## Phase 1: Fetch & Extract

Use WebFetch to read the article at the provided URL. Extract:

- **Core thesis** — What's the main argument or insight?
- **Key techniques** — Specific practices, workflows, or tools mentioned
- **Actionable advice** — Things that could be directly applied

Present a brief summary (5-8 lines max) so the user confirms it was read correctly before proceeding.

## Phase 2: Map Against Current Setup

Read these files to understand the current configuration:

```bash
# The user's installed config — not a kit checkout. Absence must be LOUD: if
# both files are missing and we silently print nothing, the gap analysis below
# runs against an empty config and confidently reports every insight as "not
# covered" — fabricated gaps, then edits proposed against a config never read.
FOUND=0

if [ -f "$HOME/.claude/CLAUDE.md" ]; then
  echo "--- ~/.claude/CLAUDE.md ---"; cat "$HOME/.claude/CLAUDE.md"; FOUND=1
fi

# Project CLAUDE.md — resolve from the repo root, not the cwd, since Claude Code
# loads the root one and /bs:read may be invoked from a subdirectory.
PROJ="$(git rev-parse --show-toplevel 2>/dev/null)/CLAUDE.md"
if [ -f "$PROJ" ]; then
  echo "--- $PROJ ---"; cat "$PROJ"; FOUND=1
fi

[ "$FOUND" -eq 1 ] || {
  echo "read: no CLAUDE.md found (checked ~/.claude/CLAUDE.md and the repo root)." >&2
  echo "      Say so explicitly — do NOT infer gaps from an empty config." >&2
}
```

For each key insight from the article, assess:

| Insight   | Current Coverage                                         | Gap?     |
| --------- | -------------------------------------------------------- | -------- |
| [insight] | [already covered by X / partially covered / not covered] | [yes/no] |

Only surface genuine gaps. If the setup already handles something well, say so and move on.

## Phase 3: Propose Changes

For each gap identified, propose a **specific change** — not vague advice. Changes can be:

- **CLAUDE.md edit** — New section, modified guidance, or removed outdated guidance
- **New command** — If the article suggests a workflow worth formalizing
- **New skill** — If the article suggests a recurring pattern worth auto-invoking
- **Workflow adjustment** — Changes to how existing commands are used
- **No changes needed** — If the setup is already aligned, say so clearly

Present proposed changes as diffs or clear before/after descriptions.

## Phase 4: Apply (with approval)

Wait for user approval before making any changes. Apply only what's approved.

After applying, update the help command and documentation sync targets if a new command was created (per CLAUDE.md documentation sync rules).

## Guidelines

- Only propose changes that provide genuine improvement — not every insight warrants a change.
- CLAUDE.md should stay under 100 lines — if adding, compress or remove elsewhere.
- Evaluate critically vs. hype. Credit the source in commit messages when changes are applied.

## Examples

```bash
/bs:read https://mitchellh.com/writing/my-ai-adoption-journey
/bs:read https://example.com/article -- focus on the testing strategy parts
```
