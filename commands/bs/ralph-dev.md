---
name: bs:ralph-dev
description: 'Autonomous backlog iteration with learning loops - work through multiple items without intervention'
argument-hint: '[--until "10 items"] [--scope all] [--section all] [--quality auto] [--no-merge] [--no-fresh] [--teams] [--max-retries 3] [--max-ci-retries 2] [--dry-run]'
tags: [workflow, autonomous, backlog, learning]
category: development
model: sonnet
---

# /bs:ralph-dev - Autonomous Backlog Iteration

**Usage**: `/bs:ralph-dev [--until "N items"] [--scope all|feature|bug] [--section all|high|medium|low] [--quality auto|95|98] [--no-merge] [--no-fresh] [--teams] [--max-retries N] [--max-ci-retries M] [--dry-run]`

**Defaults**: 10 items, all types, all sections, auto quality (smart 95/98), merge enabled, fresh context per item

Autonomously works through backlog items with learning capture. Picks highest-value items, implements them, runs quality gates, captures learnings, and loops until a stop condition is met.

Based on [Ralph concepts](https://github.com/snarktank/ralph) - fresh context, structured state, learning promotion.

## Flags

| Flag               | Default        | Description                                                                                  |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------- |
| `--until`          | **"10 items"** | Stop condition: `"N items"`, `"N hours"`, `"checkpoint:name"`, `"empty"`                     |
| `--scope`          | **all**        | Filter by type: `all`, `feature`, `bug`, `effort:S`, `effort:M`                              |
| `--section`        | **all**        | Filter by priority: `all`, `high`, `medium`, `low`                                           |
| `--quality`        | **auto**       | Quality level: `auto` (smart 95/98 selection), `95`, or `98`                                 |
| `--merge`          | **enabled**    | Auto-merge PRs after quality passes. Use `--no-merge` to disable                             |
| `--fresh`          | **enabled**    | Fresh context per item (Task isolation). Use `--no-fresh` for shared context with `/compact` |
| `--teams`          | **disabled**   | Use agent teams for parallel item processing (max 3 teammates)                               |
| `--no-teams`       | **(default)**  | Sequential processing with Task subagents (current behavior)                                 |
| `--max-retries`    | **3**          | Max fix-retry cycles per item before marking blocked                                         |
| `--max-ci-retries` | **2**          | Max CI failure recovery attempts after PR created                                            |
| `--dry-run`        | **disabled**   | Add `--dry-run` to preview plan without executing                                            |

## Stop Conditions

```bash
--until empty                # Until ALL backlog sections are empty (respects --section filter)
--until "3 items"            # After completing 3 items
--until "4 hours"            # Time limit (max 5hr hard limit)
--until "checkpoint:mvp"     # Stop at named checkpoint in BACKLOG.md
--until "item:CS-015"        # Stop after completing specific item
```

---

## Architecture (Ralph-Style)

```
RALPH-DEV LOOP
├── ralph-dev-state.json (tracking) <-> session-learnings.md (temporary) -> docs/session-learnings.md (promoted)
│
├── ITERATION LOOP (per item)
│   1. Load state -> pick highest priority incomplete
│   2. git checkout -b [type]/[ID]-[slug]
│   3. Implement item (fresh agent or current context)
│   4. /bs:quality --merge --level [auto|95|98]
│   ├── LOCAL RETRY LOOP (max N): If quality fails -> fix -> retry; if max retries -> mark blocked
│   5. PR created -> CI runs
│   ├── CI RECOVERY LOOP (max M): auto-fix lint/types -> push -> retry; complex -> backlog item
│   6. PR merged -> back on main
│   7. Update state.json + BACKLOG.md
│   8. Capture learnings -> session file
│   9. /compact (if --no-fresh) -> next item
│
└── END OF RUN (automatic)
    • Auto-promote learnings -> docs/session-learnings.md
    • Clear session learnings file
    • Archive run in state.json
```

---

## Agent Teams Mode (`--teams`) (CS-102)

**When `TEAMS=true`, process multiple backlog items in parallel using agent teammates.**

The lead spawns up to 3 teammates that each work on a separate item concurrently. The lead manages BACKLOG.md state (sole writer), coordinates merge order, and handles blocked items.

**Throughput gain:** 3x less wall-clock time with 3 parallel teammates.
**When to use:** Best for backlogs with 3+ independent items.
**If `TEAMS=false` (default), skip this section and use the sequential Implementation below.**

See `docs/ralph-dev-teams-reference.md` for full Teams implementation pseudocode, risks/mitigations, and examples.

```bash
# Teams mode examples
/bs:ralph-dev --teams --until "10 items"
/bs:ralph-dev --teams --until "4 hours"
/bs:ralph-dev --teams --max-retries 5
/bs:ralph-dev --teams --dry-run
```

---

## Implementation

**The sections below describe the sequential (default, `--no-teams`) workflow.**

### Step 0: Initialize Environment

```bash
# Parse arguments
UNTIL_CONDITION="${1:-10 items}"
SCOPE="${2:-all}"
SECTION="${3:-all}"
QUALITY_LEVEL="${4:-auto}"
AUTO_MERGE="${5:-true}"
FRESH_CONTEXT="${6:-true}"
MAX_RETRIES="${7:-3}"
MAX_CI_RETRIES="${8:-2}"
DRY_RUN="${9:-false}"

# Ensure git root
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$GIT_ROOT" ]]; then
  echo "Not in a git repository"
  exit 1
fi
cd "$GIT_ROOT"

# Branch hygiene - ensure clean state before starting
git checkout main && git pull && git fetch --prune
git branch --merged main | grep -v 'main' | xargs -r git branch -d
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D

# Initialize state and tracking files
STATE_FILE=".claude/ralph-dev-state.json"
LEARNINGS_FILE=".claude/session-learnings.md"
PROGRESS_FILE=".claude/ralph-dev-progress.json"
BLOCKED_FILE=".claude/blocked-items.md"
mkdir -p .claude

ITEMS_COMPLETED=0
ERRORS=0
SESSION_START=$(date +%s)
MAX_SESSION_SECONDS=18000  # 5 hour hard limit
TOTAL_COST=0
ITEM_DURATIONS=()

echo "RALPH-DEV: Autonomous Backlog Iteration"
echo "  Until: $UNTIL_CONDITION | Scope: $SCOPE | Section: $SECTION"
echo "  Quality: ${QUALITY_LEVEL}% | Auto-merge: $AUTO_MERGE | Fresh: $FRESH_CONTEXT"
echo "  Max retries: $MAX_RETRIES | Max CI retries: $MAX_CI_RETRIES | Dry run: $DRY_RUN"

# Initialize HUD state (CS-061)
HUD_SCRIPT="${HOME}/Projects/claude-setup/scripts/hud-update.sh"
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --start --command "/bs:ralph-dev" --status "running"
fi

# Initialize progress file with total items, ETA, current item tracking
# Updated at each item start/complete via update_progress()
init_progress_file
```

### Step 1: Load/Create State File

```bash
if [ -f "$STATE_FILE" ]; then
  echo "Loaded existing state file"
else
  echo '{"version":"1.0","items":[],"sessionStats":{},"errorPatterns":{},"moduleHotspots":[]}' > "$STATE_FILE"
fi
```

**State file tracks:** item status (passes/blocked/retries/ciRetries), branches, PRs, learnings, error patterns, and module hotspots.

### Step 2: Parse BACKLOG.md

```bash
# 1. Read ALL sections: High Value, Medium Value, Low Value
# 2. Apply --section filter (all, high, medium, low)
# 3. Apply --scope filter (all, feature, bug, effort:S, effort:M)
# 4. Sort by score (highest first)
# 5. Skip already-completed/blocked items from state file
# 6. Pick first item
# With default --section all, items are picked by score across all sections.
```

### Step 3: Dry Run Preview (if --dry-run)

If DRY_RUN is true, display configuration and ordered item table, then exit with "To execute: Run without `--dry-run`".

### Step 4: Main Loop

```bash
while true; do
  check_stop_condition "$UNTIL_CONDITION" && break

  # Check 5-hour session time limit
  ELAPSED=$(($(date +%s) - SESSION_START))
  [ $ELAPSED -ge $MAX_SESSION_SECONDS ] && break

  NEXT_ITEM=$(get_next_item "$SCOPE")
  [ -z "$NEXT_ITEM" ] && break

  ITEM_ID=$(echo "$NEXT_ITEM" | jq -r '.id')
  ITEM_DESC=$(echo "$NEXT_ITEM" | jq -r '.description')
  ITEM_TYPE=$(echo "$NEXT_ITEM" | jq -r '.type')

  echo "Starting: $ITEM_ID - $ITEM_DESC"
  update_state "$ITEM_ID" "startedAt" "$(date -Iseconds)"

  # Create branch from type and ID
  BRANCH_TYPE=$(echo "$ITEM_TYPE" | tr '[:upper:]' '[:lower:]')
  BRANCH_SLUG=$(echo "$ITEM_DESC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | cut -c1-30)
  BRANCH_NAME="${BRANCH_TYPE}/${ITEM_ID}-${BRANCH_SLUG}"
  git checkout -b "$BRANCH_NAME"

  # Implement with retry loop
  RETRY=0
  QUALITY_PASSED=false

  while [ $RETRY -lt $MAX_RETRIES ]; do
    [ $RETRY -gt 0 ] && echo "Retry $RETRY/$MAX_RETRIES for $ITEM_ID..."
    implement_item "$ITEM_ID" "$ITEM_DESC" "$RETRY"

    if run_quality "$QUALITY_LEVEL"; then
      QUALITY_PASSED=true
      break
    fi
    RETRY=$((RETRY + 1))
    update_state "$ITEM_ID" "retries" "$RETRY"
  done

  if [ "$QUALITY_PASSED" = false ]; then
    echo "$ITEM_ID blocked after $MAX_RETRIES attempts"
    update_state "$ITEM_ID" "blocked" "true"
    update_state "$ITEM_ID" "blockReason" "$LAST_FAILURE_OUTPUT"
    track_error_pattern "$LAST_FAILURE_TYPE"
    create_recovery_branch "$ITEM_ID" "$BRANCH_NAME" "$LAST_FAILURE_OUTPUT"
    git checkout main
    ERRORS=$((ERRORS + 1))
    continue
  fi

  capture_learnings "$ITEM_ID" "$ITEM_DESC"
  move_to_completed "$ITEM_ID"
  git checkout main && git pull

  ITEMS_COMPLETED=$((ITEMS_COMPLETED + 1))
  update_state "$ITEM_ID" "passes" "true"
  update_state "$ITEM_ID" "completedAt" "$(date -Iseconds)"
  echo "Completed: $ITEM_ID ($ITEMS_COMPLETED total)"

  # Compact if not fresh context
  if [ "$FRESH_CONTEXT" = false ]; then
    auto_checkpoint_before_compact
    /compact
  fi
done
```

### Step 4.2: Implementation (Fresh Agent or Current Context)

**If FRESH_CONTEXT is true (default):** Use Task tool to spawn a fresh agent.

**Step 4.2.1: Load Relevant Learnings (CS-073)** - Extract keywords from item description, load from learning index via `extract-learnings.sh format/search`.

**Step 4.2.2: Spawn Agent with Learnings**

Task(prompt: "Implement backlog item [ITEM_ID] - [DESCRIPTION] on branch [BRANCH_NAME]. Context includes type, retry count, previous failure output if retrying, and injected learnings from similar completed items. Instructions: review learnings, read backlog detail file, assess complexity, implement with tests, commit, run /bs:quality --merge --level [LEVEL]. If retrying: checkout existing branch, fix only specific issues reported, re-run quality.")

**Never commit directly to main. Same flow as /bs:dev -> /bs:quality --merge.**

### Step 4.3: Quality & Merge (Handled by /bs:quality --merge)

Quality and merge are handled INSIDE Step 4.2 by `/bs:quality --merge` which runs lint, typecheck, tests, build, quality agents, creates PR, waits for CI, and auto-merges. If it fails, the retry loop kicks in feeding `LAST_FAILURE_OUTPUT` back to the implementation agent. Items exhausting retries are marked blocked and skipped (not a full stop).

### Step 4.3.1: Merge Verification (CRITICAL)

After `/bs:quality --merge` completes, verify the merge actually happened via `gh pr view --json state`. Handles MERGED (success), OPEN (check CI, wait if pending, retry), CLOSED (failure), and UNKNOWN states. Failed verification triggers CI recovery or marks as blocked. **This prevents false success reports when CI blocks the merge silently.**

### Step 4.3.2: CI Failure Recovery (Hybrid Auto-Fix + Backlog)

When CI fails AFTER PR is created, this recovery loop activates (up to MAX_CI_RETRIES).

```bash
CI_RETRY=0
PR_NUMBER=$(gh pr view --json number --jq '.number')

while [ $CI_RETRY -lt $MAX_CI_RETRIES ]; do
  gh pr checks "$PR_NUMBER" --watch --fail-fast 2>/dev/null || true
  FAILED_CHECKS=$(gh pr checks "$PR_NUMBER" --json name,conclusion \
    --jq '.[] | select(.conclusion == "FAILURE") | .name')
  [ -z "$FAILED_CHECKS" ] && break

  for CHECK_NAME in $FAILED_CHECKS; do
    # Get failure log from gh run view --log-failed
    # Categorize: lint|typecheck|import -> AUTO_FIXABLE=true
    #             test|docs|security    -> AUTO_FIXABLE=false

    if [ "$AUTO_FIXABLE" = true ]; then
      # Checkout PR branch, apply fix (lint:fix, agent analysis, etc.)
      # Stage, commit "fix(ci): auto-fix $FAILURE_TYPE errors", push
    else
      # Create backlog item B-XXX for the CI fix (High Value priority)
      # Create detail file in docs/backlog-items/
      # Commit via PR workflow, then merge original PR with --admin and "known-issue" label
      break
    fi
  done
  CI_RETRY=$((CI_RETRY + 1))
done
```

**Failure Type Detection:**

| Type        | Detection Pattern                    | Action                    |
| ----------- | ------------------------------------ | ------------------------- |
| `lint`      | ESLint, Lint error, lint-staged      | Auto-fix: `pnpm lint:fix` |
| `typecheck` | TS\d{4}, type error, TypeScript      | Auto-fix: agent analysis  |
| `import`    | Cannot find module, Module not found | Auto-fix: add export/path |
| `test`      | FAIL, Test failed, expect(           | Create backlog item       |
| `docs`      | documentation, README                | Create backlog item       |
| `security`  | vulnerability, CVE, Trivy            | Create backlog item       |

### Step 4.4: Capture Learnings

Append to `session-learnings.md` per item: status, duration, files changed, PR number, What Worked, Gotchas, Patterns Discovered. Update state file with learnings array.

**Step 4.4.1: Sync to Learning Index (CS-073)** - After capturing, sync to `.claude/learning-index.json` via `extract-learnings.sh add` for keyword-based lookup by future agents.

### Step 4.5: Update BACKLOG.md (CRITICAL - MUST RELOCATE)

**CRITICAL: Completed items MUST be MOVED to the "## Completed" section, not just status-changed.**

1. DELETE the item's table row AND detail block from active section
2. ADD a simplified row to "## Completed" section (no Value Drivers, Effort, Score columns)
3. Group with other items completed on the same date
4. Commit BACKLOG.md update

### Step 5: Session End (MANDATORY)

**CRITICAL: This step MUST execute after the main loop completes.**

```bash
ELAPSED_MINS=$(( ($(date +%s) - SESSION_START) / 60 ))
echo "RALPH-DEV SESSION COMPLETE"
echo "  Items completed: $ITEMS_COMPLETED | Blocked: $ERRORS | Duration: ${ELAPSED_MINS}min"

# MANDATORY: Promote learnings + sync index
promote_learnings   # Step 5.1
sync_learnings_to_index          # Step 5.2
update_session_stats "$ITEMS_COMPLETED" "$ERRORS"
```

**Agent Checklist for Session End:**

1. [ ] Display session stats (items completed, blocked, duration)
2. [ ] **MUST CALL** `promote_learnings()` - see Step 5.1
3. [ ] **MUST CALL** `sync_learnings_to_index()` - see Step 5.2 (CS-073)
4. [ ] Update session stats in state file
5. [ ] Confirm completion to user

### Step 5.1: Promote Learnings to docs/session-learnings.md

**This promotion pipeline MUST run at the end of every ralph-dev session.**

```bash
promote_learnings() {
  LEARNINGS_FILE=".claude/session-learnings.md"
  TARGET_FILE="docs/session-learnings.md"
  # 1. Check if learnings file exists and has content (>50 chars)
  # 2. Extract significant sections: Patterns Discovered, What Worked, Gotchas
  # 3. Verify significance (combined content >= 100 chars)
  # 4. If significant:
  #    - Append dated section with item count and extracted learnings to $TARGET_FILE
  #    - Git commit "docs(learnings): promote ralph-dev session patterns"
  #    - Push via PR workflow (handles block-push-main hook)
  # 5. ALWAYS clear session-learnings.md (regardless of significance)
}
```

**Significance criteria:** >=100 chars of extracted content, or contains Patterns Discovered/Gotchas sections.

### Step 5.2: Sync Learnings to Index (CS-073)

```bash
sync_learnings_to_index() {
  # Run extract-learnings.sh sync to update .claude/learning-index.json
  # Enables fast keyword-based lookup for agent context injection
  # Non-critical: failure is logged but doesn't block session end
}
```

### Step 5.0.1: Helper Functions for Error Tracking & Recovery

**track_error_pattern(type, module_path):** Normalizes error type to categories (lint/typecheck/test/build/import/docs/security), increments count in state file errorPatterns, tracks module hotspots with error counts and types.

**create_recovery_branch(item_id, branch, failure_output):** Renames branch to `recovery/[ID]-[date]`, documents failure in blocked-items.md, creates GitHub issue with investigation checklist.

**auto_checkpoint_before_compact():** Archives existing checkpoint to `data/context/history/`, creates new quick checkpoint via `/bs:session save --quick` before `/compact` clears context.

---

## Examples

```bash
/bs:ralph-dev                                # Default: 10 items, auto quality, merge enabled
/bs:ralph-dev --until "4 hours"              # Work for 4 hours
/bs:ralph-dev --scope bug --quality 98       # Only bugs, 98% quality
/bs:ralph-dev --until "checkpoint:mvp"       # Until specific checkpoint
/bs:ralph-dev --dry-run                      # Preview what would run
/bs:ralph-dev --no-fresh                     # Shared context (faster but may need /compact)
/bs:ralph-dev --max-ci-retries 3             # More CI recovery attempts
/bs:ralph-dev --section high --until empty   # Only High Value items
/bs:ralph-dev --teams --until "10 items"     # Teams mode: parallel processing
```

---

## Troubleshooting

| Issue                   | Solution                                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| "Not in git repo"       | Run from project root                                                      |
| Item keeps failing      | Check `ralph-dev-state.json` for blockReason                               |
| CI keeps failing        | Increase `--max-ci-retries` or check workflow logs                         |
| Wrong items picked      | Verify BACKLOG.md format matches expected pattern                          |
| Learnings not promoted  | Check `.claude/session-learnings.md` and `docs/session-learnings.md` exist |
| Session too long        | Use `--until "2 hours"` to limit                                           |
| Teams: merge conflicts  | Lead sequences merges; reduce to 2 teammates                               |
| Teams: high token usage | Use `--no-teams` for small backlogs (<3 items)                             |

---

## Related Commands

- `/bs:dev` - Single item development
- `/bs:quality --merge` - Quality gate + merge
- `/bs:backlog` - View/manage backlog
- `/bs:session --list` - View past sessions
