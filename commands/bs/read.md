---
model: sonnet
name: bs:read
description: 'Read an article/post and extract actionable insights for your setup'
argument-hint: '<url> → read, analyze, propose setup improvements'
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
# Global config
cat ~/Projects/claude-kit/config/CLAUDE.md

# Project CLAUDE.md (session learnings, workflows)
cat ~/Projects/claude-kit/CLAUDE.md
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
