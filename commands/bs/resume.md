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

Shortcut to resume last session or checkpoint. Auto-detects what to restore.

## Quick Reference

```bash
/bs:resume              # Resume last checkpoint
/bs:resume my-session   # Resume specific session
```

## What It Does

```
1. Check for active checkpoint (data/context/checkpoint.md)
   └─ If found: Show context summary + Load checkpoint

2. Check for recent sessions (data/sessions/)
   └─ If checkpoint not found: Show context summary + Load most recent session

3. If session-id provided
   └─ Show context summary + Load specific session
```

**Context summary includes:**

- Branch name
- Last active time (hours/days ago)
- Files in progress or recently modified
- Test status (passing/failing counts)
- Next planned step
- Current git status and diff stats

## vs Other Commands

| Command                    | What it resumes                              |
| -------------------------- | -------------------------------------------- |
| `/bs:resume`               | Last quick checkpoint OR last session (auto) |
| `/bs:session load --quick` | Last quick checkpoint (explicit)             |
| `/bs:session load <id>`    | Specific session (explicit)                  |

## Implementation

```bash
#!/bin/bash

SESSION_ID="$1"
CHECKPOINT_FILE="data/context/checkpoint.md"
SESSIONS_DIR="data/sessions"

# Helper function to display FULL context summary (CS-067 fix)
# This implements the spec from CS-056 that was marked complete but not fully implemented
# Works with or without checkpoint.json - gathers live data when needed
display_context_summary() {
  local checkpoint_json="$1"
  local has_checkpoint=false

  # Check if we have a valid checkpoint file
  if [ -f "$checkpoint_json" ] && [ "$checkpoint_json" != "/dev/null" ]; then
    has_checkpoint=true
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📌 SESSION CONTEXT SUMMARY"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Get current branch
  local current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

  # Calculate time ago
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

  echo "📌 Resuming: $current_branch"
  echo "🕐 Last active: $time_ago"
  echo ""

  # Run git diff --stat automatically (CS-056 requirement)
  echo "## Recent Changes (git diff --stat)"
  echo ""
  local uncommitted_count=$(git status --short 2>/dev/null | wc -l | tr -d ' ')
  if [ "$uncommitted_count" -gt 0 ]; then
    echo "**$uncommitted_count uncommitted changes:**"
    echo ""
    git diff --stat 2>/dev/null || true
    git diff --cached --stat 2>/dev/null || true
    echo ""
  else
    echo "No uncommitted changes"
    echo ""

    # Show recent commits instead
    echo "**Recent commits:**"
    git log --oneline -5 2>/dev/null || true
    echo ""
  fi

  # Files in progress from checkpoint or git status
  echo "## Files in Progress"
  echo ""
  if [ -f "$checkpoint_json" ]; then
    local files_in_progress=$(jq -r '.filesInProgress[]? // empty' "$checkpoint_json" 2>/dev/null)
    if [ -n "$files_in_progress" ]; then
      echo "$files_in_progress" | sed 's/^/  - /'
    else
      # Fall back to git status
      git status --short 2>/dev/null | head -10 | sed 's/^/  /'
    fi
  else
    git status --short 2>/dev/null | head -10 | sed 's/^/  /'
  fi
  echo ""

  # Test status from last run (CS-056 requirement)
  echo "## Test Status"
  echo ""
  if [ -f "$checkpoint_json" ]; then
    local tests_passing=$(jq -r '.testsStatus.passing // "?"' "$checkpoint_json" 2>/dev/null)
    local tests_total=$(jq -r '.testsStatus.total // "?"' "$checkpoint_json" 2>/dev/null)

    if [ "$tests_total" != "?" ] && [ "$tests_total" != "0" ] && [ "$tests_total" != "null" ]; then
      if [ "$tests_passing" = "$tests_total" ]; then
        echo "✅ Tests: $tests_passing/$tests_total passing"
      else
        local tests_failing=$((tests_total - tests_passing))
        echo "⚠️  Tests: $tests_passing/$tests_total passing ($tests_failing failing)"
      fi
    else
      # Quick test check
      if [ -f "package.json" ]; then
        echo "Running quick test check..."
        if npm run test --if-present 2>&1 | tail -3 | grep -q "passed\|passing"; then
          echo "✅ Tests passing"
        else
          echo "⚠️  Check tests with: npm test"
        fi
      else
        echo "ℹ️  Test status unknown"
      fi
    fi
  else
    echo "ℹ️  Test status unknown (no checkpoint)"
  fi
  echo ""

  # Session cost (CS-056 requirement)
  echo "## Session Cost"
  echo ""
  local cost_file="${HOME}/.claude/cost-tracking.json"
  if [ -f "$cost_file" ]; then
    local branch_cost=$(jq -r --arg branch "$current_branch" '.branches[$branch].cost // 0' "$cost_file" 2>/dev/null)
    local branch_calls=$(jq -r --arg branch "$current_branch" '.branches[$branch].calls // 0' "$cost_file" 2>/dev/null)

    if [ "$branch_cost" != "0" ] && [ "$branch_cost" != "null" ]; then
      printf "💰 Branch cost: \$%.2f (%d API calls)\n" "$branch_cost" "$branch_calls"
    else
      echo "💰 No cost data for this branch yet"
    fi
  else
    echo "💰 Cost tracking not initialized"
  fi
  echo ""

  # Next step from checkpoint
  echo "## Next Step"
  echo ""
  if [ -f "$checkpoint_json" ]; then
    local next_step=$(jq -r '.nextSteps[0] // "Continue work"' "$checkpoint_json" 2>/dev/null)
    echo "🎯 $next_step"
  else
    echo "🎯 Continue work"
  fi
  echo ""

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

# Helper function to show current git state
show_current_state() {
  echo "📊 Current state:"
  echo ""

  # Git status
  if git rev-parse --git-dir > /dev/null 2>&1; then
    echo "Git status:"
    git status --short
    echo ""

    # Git diff stat (if any changes)
    if git diff --quiet HEAD 2>/dev/null; then
      echo "No uncommitted changes"
    else
      echo "Uncommitted changes:"
      git diff --stat HEAD
    fi
    echo ""
  fi
}

echo "🔄 Resuming work..."
echo ""

# If session ID provided, load that specific session
if [ -n "$SESSION_ID" ]; then
  if [ -d "$SESSIONS_DIR/$SESSION_ID" ]; then
    # Show context summary if checkpoint.json exists
    if [ -f "$SESSIONS_DIR/$SESSION_ID/checkpoint.json" ]; then
      display_context_summary "$SESSIONS_DIR/$SESSION_ID/checkpoint.json"
      show_current_state
    fi

    /bs:session load "$SESSION_ID"
    exit 0
  else
    echo "❌ Session not found: $SESSION_ID"
    echo ""
    echo "Available sessions:"
    /bs:session list
    exit 1
  fi
fi

# Otherwise, check for checkpoint first (most recent work)
if [ -f "$CHECKPOINT_FILE" ]; then
  echo "📂 Found quick checkpoint, resuming..."
  echo ""

  # Check for checkpoint.json (structured data) or fall back to checkpoint.md
  CHECKPOINT_JSON="data/context/checkpoint.json"
  if [ -f "$CHECKPOINT_JSON" ]; then
    # Use structured checkpoint data for rich summary
    display_context_summary "$CHECKPOINT_JSON"
  else
    # Fall back to checkpoint.md display with inline context gathering
    # Even without checkpoint.json, we can still show a rich summary
    display_context_summary "/dev/null"  # Pass null, function will gather live data
  fi

  show_current_state

  /bs:session load --quick
  exit 0
fi

# No checkpoint, try to find most recent session
if [ -d "$SESSIONS_DIR" ]; then
  LATEST_SESSION=$(ls -t "$SESSIONS_DIR" | head -n 1)

  if [ -n "$LATEST_SESSION" ]; then
    echo "📂 No checkpoint found. Resuming last session: $LATEST_SESSION"
    echo ""

    # Show context summary if checkpoint.json exists
    if [ -f "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json" ]; then
      display_context_summary "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json"
      show_current_state
    fi

    /bs:session load "$LATEST_SESSION"
    exit 0
  fi
fi

# Nothing to resume
echo "❌ Nothing to resume"
echo ""
echo "No checkpoint or sessions found."
echo ""
echo "Create checkpoint: /bs:session save --quick"
echo "Create session: /bs:session save <name>"
exit 1
```

## Usage Examples

### After Quick Break

```bash
# Before break
/bs:session save --quick

# After break
/bs:resume
# ✅ Loads checkpoint automatically
```

### After Long Break

```bash
# Before break (multi-day)
/bs:session save dark-mode

# Days later
/bs:resume dark-mode
# ✅ Loads full session
```

### After Interruption

```bash
# Working on feature
# ... system crash or forced quit ...

# When back
/bs:resume
# ✅ Loads last checkpoint or session (whichever is most recent)
```

## Auto-Detection Logic

```
Resume Priority:
1. Specific session ID (if provided)
2. Checkpoint (data/context/checkpoint.md) - most recent work
3. Last session (most recently modified in data/sessions/)
4. Nothing found - error

Rationale:
- Checkpoint = active work (last few hours)
- Session = older work (multi-day)
- Load most recent context automatically
```

## Integration with Workflow

### Typical Flow

```bash
# Day 1 - Start feature
/bs:dev dark-mode
# ... work for 2 hours ...
/bs:session save --quick

# Lunch break

# After lunch
/bs:resume
# ✅ Continue immediately

# End of day
/bs:session save dark-mode

# Day 2
/bs:resume
# ✅ Loads dark-mode session automatically
```

### Multiple Features

```bash
# Feature A
/bs:dev feature-a
# ... work ...
/bs:session save feature-a

# Feature B
/bs:dev feature-b
# ... work ...
/bs:session save --quick

# Resume most recent (feature-b checkpoint)
/bs:resume
# ✅ Loads feature-b checkpoint

# Resume specific feature
/bs:resume feature-a
# ✅ Loads feature-a session
```

## Benefits

**Speed:**

- No need to remember command (checkpoint vs session)
- No need to remember session ID
- Just `/bs:resume` - it figures it out

**Smart:**

- Loads most recent work automatically
- Prefers checkpoint (active work) over session (older work)
- Falls back gracefully

**Universal:**

- Works after quick breaks (checkpoint)
- Works after long breaks (session)
- Works after interruptions (auto-detect)

## When to Use Each

```bash
# Just broke for lunch, coming back
/bs:resume                      # ✅ Quick and automatic

# Know exactly which session to resume
/bs:session load my-feature     # ✅ Explicit

# Want to see what's available first
/bs:session list                # ✅ See options
/bs:session load <id>           # ✅ Choose

# Quick break, know it's a quick checkpoint
/bs:session load --quick             # ✅ Explicit
```

## Aliases

You could alias this for even faster resumption:

```bash
# In ~/.zshrc or ~/.bashrc
alias resume='/bs:resume'

# Then just
resume
```

## See Also

- `/bs:session` - Full session management (use `--quick` for quick saves)
- `/bs:dev` - Start development work
- `/clear` - Start fresh conversation
