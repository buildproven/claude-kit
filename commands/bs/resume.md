---
name: bs:resume
description: Resume last session or checkpoint (shortcut)
argument-hint: '[session-id] → resume last checkpoint or session'
tags: [agents, workflow, quick-resume]
category: agents
model: haiku
---

# /bs:resume - Quick Resume

**Usage**: `/bs:resume [session-id]`

Auto-detects and restores the most recent checkpoint or session.

```bash
/bs:resume              # Resume last checkpoint
/bs:resume my-session   # Resume specific session
```

**Resume Priority:**

1. Specific session ID (if provided)
2. Checkpoint (`data/context/checkpoint.md`) — most recent work
3. Last session (most recently modified in `data/sessions/`)
4. Nothing found → error

## Implementation

```bash
#!/bin/bash

SESSION_ID="$1"
CHECKPOINT_FILE="data/context/checkpoint.md"
SESSIONS_DIR="data/sessions"

display_context_summary() {
  local checkpoint_json="$1"
  local current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  local time_ago="unknown"
  if [ -f "$checkpoint_json" ]; then
    local last_active=$(jq -r '.lastActive // .created // ""' "$checkpoint_json" 2>/dev/null)
    if [ -n "$last_active" ] && [ "$last_active" != "null" ]; then
      local last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$last_active" +%s 2>/dev/null || date -d "$last_active" +%s 2>/dev/null || echo "0")
      if [ "$last_epoch" != "0" ]; then
        local now_epoch=$(date +%s)
        local diff=$((now_epoch - last_epoch))
        local hours=$((diff / 3600))
        local days=$((hours / 24))
        if [ $days -gt 0 ]; then
          time_ago="${days} day$([ $days -ne 1 ] && echo 's' || echo '') ago"
        elif [ $hours -gt 0 ]; then
          time_ago="${hours} hour$([ $hours -ne 1 ] && echo 's' || echo '') ago"
        else
          local minutes=$((diff / 60))
          time_ago="${minutes} minute$([ $minutes -ne 1 ] && echo 's' || echo '') ago"
        fi
      fi
    fi
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📌 SESSION CONTEXT SUMMARY"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📌 Resuming: $current_branch | 🕐 Last active: $time_ago"
  echo ""

  # Recent changes
  local uncommitted_count=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
  if [ "$uncommitted_count" -gt 0 ]; then
    echo "**$uncommitted_count uncommitted changes:**"
    git diff --stat 2>/dev/null || true
    git diff --cached --stat 2>/dev/null || true
  else
    echo "No uncommitted changes. Recent commits:"
    git log --oneline -5 2>/dev/null || true
  fi
  echo ""

  # Files in progress
  echo "## Files in Progress"
  if [ -f "$checkpoint_json" ]; then
    local files_in_progress=$(jq -r '.filesInProgress[]? // empty' "$checkpoint_json" 2>/dev/null)
    [ -n "$files_in_progress" ] && echo "$files_in_progress" | sed 's/^/  - /' || git status --short 2>/dev/null | head -10 | sed 's/^/  /'
  else
    git status --short 2>/dev/null | head -10 | sed 's/^/  /'
  fi
  echo ""

  # Test status
  echo "## Test Status"
  if [ -f "$checkpoint_json" ]; then
    local tests_passing=$(jq -r '.testsStatus.passing // "?"' "$checkpoint_json" 2>/dev/null)
    local tests_total=$(jq -r '.testsStatus.total // "?"' "$checkpoint_json" 2>/dev/null)
    if [ "$tests_total" != "?" ] && [ "$tests_total" != "0" ] && [ "$tests_total" != "null" ]; then
      [ "$tests_passing" = "$tests_total" ] && echo "✅ Tests: $tests_passing/$tests_total passing" || echo "⚠️  Tests: $tests_passing/$tests_total passing ($((tests_total - tests_passing)) failing)"
    else
      [ -f "package.json" ] && npm run test --if-present 2>&1 | tail -3 | grep -q "passed\|passing" && echo "✅ Tests passing" || echo "⚠️  Check tests: npm test"
    fi
  else
    echo "ℹ️  Test status unknown (no checkpoint)"
  fi
  echo ""

  # Session cost
  echo "## Session Cost"
  local cost_file="${HOME}/.claude/cost-tracking.json"
  if [ -f "$cost_file" ]; then
    local branch_cost=$(jq -r --arg branch "$current_branch" '.branches[$branch].cost // 0' "$cost_file" 2>/dev/null)
    local branch_calls=$(jq -r --arg branch "$current_branch" '.branches[$branch].calls // 0' "$cost_file" 2>/dev/null)
    [ "$branch_cost" != "0" ] && [ "$branch_cost" != "null" ] && printf "💰 Branch cost: \$%.2f (%d API calls)\n" "$branch_cost" "$branch_calls" || echo "💰 No cost data for this branch"
  else
    echo "💰 Cost tracking not initialized"
  fi
  echo ""

  # Next step
  echo "## Next Step"
  if [ -f "$checkpoint_json" ]; then
    echo "🎯 $(jq -r '.nextSteps[0] // "Continue work"' "$checkpoint_json" 2>/dev/null)"
  else
    echo "🎯 Continue work"
  fi
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

show_current_state() {
  if git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Git status:"; git status --short
    git diff --quiet HEAD 2>/dev/null || (echo "Uncommitted changes:"; git diff --stat HEAD)
  fi
}

echo "🔄 Resuming work..."

# Specific session
if [ -n "$SESSION_ID" ]; then
  if [ -d "$SESSIONS_DIR/$SESSION_ID" ]; then
    [ -f "$SESSIONS_DIR/$SESSION_ID/checkpoint.json" ] && display_context_summary "$SESSIONS_DIR/$SESSION_ID/checkpoint.json" && show_current_state
    /bs:session load "$SESSION_ID"
    exit 0
  else
    echo "❌ Session not found: $SESSION_ID"
    /bs:session list
    exit 1
  fi
fi

# Checkpoint (most recent work)
if [ -f "$CHECKPOINT_FILE" ]; then
  CHECKPOINT_JSON="data/context/checkpoint.json"
  [ -f "$CHECKPOINT_JSON" ] && display_context_summary "$CHECKPOINT_JSON" || display_context_summary "/dev/null"
  show_current_state
  /bs:session load --quick
  exit 0
fi

# Latest session
if [ -d "$SESSIONS_DIR" ]; then
  LATEST_SESSION=$(ls -t "$SESSIONS_DIR" | head -n 1)
  if [ -n "$LATEST_SESSION" ]; then
    echo "📂 No checkpoint. Resuming last session: $LATEST_SESSION"
    [ -f "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json" ] && display_context_summary "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json" && show_current_state
    /bs:session load "$LATEST_SESSION"
    exit 0
  fi
fi

echo "❌ Nothing to resume"
echo "Create checkpoint: /bs:session save --quick"
echo "Create session: /bs:session save <name>"
exit 1
```

## vs Other Commands

| Command                    | What it resumes                              |
| -------------------------- | -------------------------------------------- |
| `/bs:resume`               | Last quick checkpoint OR last session (auto) |
| `/bs:session load --quick` | Last quick checkpoint (explicit)             |
| `/bs:session load <id>`    | Specific session (explicit)                  |
