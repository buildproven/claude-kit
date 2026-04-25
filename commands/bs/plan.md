---
name: bs:plan
description: "Create a structured spec doc before complex or multi-repo work — prevents wrong-target errors and survives context resets"
argument-hint: "<feature-name> [--multi-repo] [--edit] [--dry-run]"
tags: [planning, spec, multi-repo, workflow]
category: development
---

# /bs:plan - Spec-First Planning for Complex Work

**Usage**: `/bs:plan <name> [--multi-repo] [--edit] [--dry-run]`

Creates `docs/plans/PLAN-<name>.md`. Use before `/bs:dev` for complex tasks (6+ files, multiple valid approaches), multi-repo work, or anything where a wrong assumption causes significant rework. Plan docs persist across sessions and context resets.

**Arguments received:** $ARGUMENTS

## Flags

| Flag           | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `--multi-repo` | Adds multi-repo section (target repos, execution order, rollback)      |
| `--edit`       | Open plan doc for review after creation (recommended for complex work) |
| `--dry-run`    | Print the plan template without saving                                 |

## Implementation

### Step 1: Parse Arguments and Setup

```bash
NAME=$(echo "$ARGUMENTS" | sed 's/ *--.*//' | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
MULTI_REPO=false
DRY_RUN=false

echo "$ARGUMENTS" | grep -q '\-\-multi-repo' && MULTI_REPO=true
echo "$ARGUMENTS" | grep -q '\-\-dry-run' && DRY_RUN=true

PLAN_DIR="docs/plans"
PLAN_FILE="$PLAN_DIR/PLAN-${NAME}.md"
DATE=$(date +%Y-%m-%d)

mkdir -p "$PLAN_DIR"
```

If `NAME` is empty, ask: "What are we planning? Provide a short name for the plan."

### Step 2: Explore Codebase (via subagent)

Spawn an Explore subagent to understand the current state:

```
Task(subagent_type: "Explore",
     prompt: "Explore the codebase for context on: [NAME / task description from ARGUMENTS].

     Find:
     - Existing code relevant to this task
     - Current patterns and conventions in affected areas
     - Dependencies and integration points
     - Any prior work (check docs/plans/, docs/decisions/, Linear issues)

     Return:
     - Relevant files and their roles
     - Existing patterns to follow or avoid
     - Potential complications
     - Suggested approaches (2-3 options)")
```

Use the subagent's findings to populate the plan doc.

### Step 3: Generate Plan Document

Create `$PLAN_FILE` with this structure:

```markdown
# Plan: [NAME]

**Created:** [DATE]
**Status:** Draft
**Linked backlog item:** (if applicable, e.g. CS-XXX)

---

## Problem

[What is broken, missing, or needs to change? One paragraph. Be specific.]

---

## Options Considered

### Option A: [Name]

[Description]

**Pros:**

- [pro 1]
- [pro 2]

**Cons:**

- [con 1]

### Option B: [Name]

[Description]

**Pros:**

- [pro 1]

**Cons:**

- [con 1]

### Option C: [Name] _(if applicable)_

...

---

## Decision

**Approach:** Option [X] — [Name]

**Rationale:** [2-3 sentences. Why this option over the others?]

---

## Implementation Plan

### Files to Modify

- `path/to/file.ts` — [what changes]
- `path/to/other.ts` — [what changes]

### Files to Create

- `path/to/new.ts` — [purpose]

### Execution Order

1. [First step — why first]
2. [Second step]
3. ...

### Out of Scope

- [Explicitly excluded items — prevents scope creep]

---

## Verification Steps

1. [How to verify the change works]
2. [Edge cases to test]
3. [Commands to run: tests, lint, build]

---

## Notes / Gotchas

- [Anything that will surprise a fresh agent working from this doc]
- [Known constraints or non-obvious dependencies]
```

**If `--multi-repo` flag:** Add this section after Implementation Plan:

```markdown
---

## Multi-Repo Execution

### Target Repositories

| Repo        | Path           | Changes        | Safe to parallelize? |
| ----------- | -------------- | -------------- | -------------------- |
| [repo-name] | ~/path/to/repo | [what changes] | Yes/No               |

### Execution Order

1. [Repo A first — reason]
2. [Repo B second — depends on A because...]

### Rollback Plan

If step N fails:

- [what to revert]
- [how to verify clean state before retrying]

### Coordination Notes

- [Shared config files touched by multiple repos]
- [Env vars that must match across repos]
```

### Step 4: Save and Confirm

```bash
if [ "$DRY_RUN" = true ]; then
  echo "--- DRY RUN: would save to $PLAN_FILE ---"
  cat "$PLAN_FILE"  # print template
else
  # (file already written)
  echo ""
  echo "✅ Plan saved: $PLAN_FILE"
  echo ""
  echo "Next steps:"
  echo "  1. Review and refine the plan (edit $PLAN_FILE)"
  echo "  2. Launch implementation:"
  echo "     /bs:dev ${NAME}    (manual, with branch creation)"
  echo "     Tell claude: \"implement the plan in $PLAN_FILE\""
  echo ""
  echo "  For multi-repo work, share the plan file in each session:"
  echo "     \"Read $PLAN_FILE, then implement the changes for [repo-name]\""
fi
```

## Plan Lifecycle

| Status     | Meaning                           |
| ---------- | --------------------------------- |
| `Draft`    | Created, needs review             |
| `Ready`    | Reviewed, implementation approved |
| `Active`   | Currently being implemented       |
| `Done`     | Implementation complete           |
| `Deferred` | Postponed                         |

Update the `Status:` field in the plan doc as work progresses.

## Examples

```bash
/bs:plan dark-mode-theming
/bs:plan rebrand-old-name-to-new-name --multi-repo
/bs:plan auth-system-refactor --edit
/bs:plan api-redesign --dry-run
```
