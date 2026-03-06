---
name: bs:context
description: 'Context recovery - restore checkpoints, show diffs, view history'
argument-hint: '[--recover] [--diff] [--history] → manage context state'
tags: [context, recovery, session]
category: agents
model: haiku
---

# /bs:context - Context Recovery

**Usage**: `/bs:context [--recover] [--diff] [--history]`

Recover from lost context, see what changed since last session, or browse checkpoint history.

## Quick Reference

```bash
/bs:context                 # Show current context state
/bs:context --recover       # Restore last checkpoint
/bs:context --diff          # Show changes since last session
/bs:context --history       # List all checkpoints
```

## Why You Need This

**Context gets lost when:**

- `/compact` removes important details
- Session times out after 5 hours
- Claude Code crashes or restarts
- You switch between features

**This command helps you:**

- Recover from accidental context loss
- See what changed while you were away
- Browse past checkpoints for reference

## Implementation

### Step 1: Parse Arguments

```bash
#!/usr/bin/env bash
set -euo pipefail

MODE="status"  # status, recover, diff, history

for arg in "$@"; do
  case "$arg" in
    --recover)
      MODE="recover"
      ;;
    --diff)
      MODE="diff"
      ;;
    --history)
      MODE="history"
      ;;
  esac
done

# Paths
CHECKPOINT_FILE="data/context/checkpoint.md"
CHECKPOINT_JSON="data/context/checkpoint.json"
CHECKPOINTS_DIR="data/context/history"
SESSIONS_DIR="data/sessions"

# Ensure git root
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$GIT_ROOT" ]]; then
  echo "❌ Not in a git repository"
  exit 1
fi
cd "$GIT_ROOT"
```

### Step 2: Mode - Status (Default)

```bash
if [ "$MODE" = "status" ]; then
  echo "📋 Context Status"
  echo ""

  # Current branch and state
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  UNCOMMITTED=$(git status --short | wc -l | tr -d ' ')

  echo "**Branch:** $CURRENT_BRANCH"
  echo "**Uncommitted files:** $UNCOMMITTED"
  echo ""

  # Check for checkpoints
  if [ -f "$CHECKPOINT_FILE" ]; then
    CHECKPOINT_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$CHECKPOINT_FILE" 2>/dev/null || stat -c "%y" "$CHECKPOINT_FILE" 2>/dev/null | cut -d'.' -f1)
    echo "**Quick checkpoint:** Available (saved $CHECKPOINT_TIME)"
  else
    echo "**Quick checkpoint:** None"
  fi

  # Check for sessions
  if [ -d "$SESSIONS_DIR" ]; then
    SESSION_COUNT=$(ls -1 "$SESSIONS_DIR" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$SESSION_COUNT" -gt 0 ]; then
      LATEST_SESSION=$(ls -t "$SESSIONS_DIR" 2>/dev/null | head -1)
      echo "**Sessions:** $SESSION_COUNT available (latest: $LATEST_SESSION)"
    else
      echo "**Sessions:** None"
    fi
  else
    echo "**Sessions:** None"
  fi

  # Check for checkpoint history
  if [ -d "$CHECKPOINTS_DIR" ]; then
    HISTORY_COUNT=$(ls -1 "$CHECKPOINTS_DIR" 2>/dev/null | wc -l | tr -d ' ')
    echo "**Checkpoint history:** $HISTORY_COUNT saved"
  else
    echo "**Checkpoint history:** None"
  fi

  echo ""
  echo "**Commands:**"
  echo "  /bs:context --recover   # Restore last checkpoint"
  echo "  /bs:context --diff      # See what changed"
  echo "  /bs:context --history   # Browse checkpoints"
fi
```

### Step 3: Mode - Recover

```bash
if [ "$MODE" = "recover" ]; then
  echo "🔄 Recovering Context..."
  echo ""

  # Priority: checkpoint.json > checkpoint.md > latest session
  if [ -f "$CHECKPOINT_JSON" ]; then
    echo "Found: checkpoint.json"

    # Extract key information
    BRANCH=$(jq -r '.branch // "unknown"' "$CHECKPOINT_JSON")
    FILES_IN_PROGRESS=$(jq -r '.filesInProgress[]? // empty' "$CHECKPOINT_JSON" | head -5)
    NEXT_STEPS=$(jq -r '.nextSteps[]? // empty' "$CHECKPOINT_JSON" | head -3)
    LAST_COMMAND=$(jq -r '.lastCommand // "unknown"' "$CHECKPOINT_JSON")

    echo ""
    echo "**Restoring context from checkpoint:**"
    echo ""
    echo "Branch: $BRANCH"
    echo ""

    if [ -n "$FILES_IN_PROGRESS" ]; then
      echo "Files in progress:"
      echo "$FILES_IN_PROGRESS" | sed 's/^/  - /'
      echo ""
    fi

    if [ -n "$NEXT_STEPS" ]; then
      echo "Next steps:"
      echo "$NEXT_STEPS" | sed 's/^/  - /'
      echo ""
    fi

    echo "Last command: $LAST_COMMAND"
    echo ""

    # Show git state
    echo "**Current git state:**"
    git status --short
    echo ""

    # Show diff if any changes
    if ! git diff --quiet HEAD 2>/dev/null; then
      echo "**Uncommitted changes:**"
      git diff --stat
      echo ""
    fi

    echo "✅ Context restored. Use /bs:resume for full session restore."

  elif [ -f "$CHECKPOINT_FILE" ]; then
    echo "Found: checkpoint.md"
    echo ""
    cat "$CHECKPOINT_FILE"
    echo ""
    echo "✅ Checkpoint content displayed above."

  elif [ -d "$SESSIONS_DIR" ]; then
    LATEST_SESSION=$(ls -t "$SESSIONS_DIR" 2>/dev/null | head -1)
    if [ -n "$LATEST_SESSION" ]; then
      echo "No checkpoint found. Recovering from latest session: $LATEST_SESSION"
      echo ""

      if [ -f "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json" ]; then
        jq '.' "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json"
      elif [ -f "$SESSIONS_DIR/$LATEST_SESSION/context.md" ]; then
        cat "$SESSIONS_DIR/$LATEST_SESSION/context.md"
      fi

      echo ""
      echo "✅ Session context displayed. Use /bs:resume $LATEST_SESSION for full restore."
    else
      echo "❌ No checkpoints or sessions found"
      exit 1
    fi
  else
    echo "❌ No checkpoints or sessions found"
    echo ""
    echo "Create a checkpoint with: /bs:session save --quick"
    exit 1
  fi
fi
```

### Step 4: Mode - Diff

```bash
if [ "$MODE" = "diff" ]; then
  echo "📊 Changes Since Last Session"
  echo ""

  # Find last checkpoint timestamp
  LAST_CHECKPOINT=""

  if [ -f "$CHECKPOINT_JSON" ]; then
    LAST_CHECKPOINT=$(jq -r '.timestamp // empty' "$CHECKPOINT_JSON")
  elif [ -f "$CHECKPOINT_FILE" ]; then
    LAST_CHECKPOINT=$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%S" "$CHECKPOINT_FILE" 2>/dev/null || stat -c "%y" "$CHECKPOINT_FILE" 2>/dev/null)
  fi

  if [ -z "$LAST_CHECKPOINT" ]; then
    echo "⚠️  No checkpoint found. Showing recent changes instead."
    LAST_CHECKPOINT="1 day ago"
  fi

  echo "**Since:** $LAST_CHECKPOINT"
  echo ""

  # Git commits since checkpoint
  echo "## Commits"
  echo ""
  git log --oneline --since="$LAST_CHECKPOINT" 2>/dev/null || git log --oneline -10
  echo ""

  # Files changed
  echo "## Files Changed"
  echo ""
  git diff --stat HEAD~10...HEAD 2>/dev/null || git diff --stat
  echo ""

  # Uncommitted changes
  UNCOMMITTED=$(git status --short | wc -l | tr -d ' ')
  if [ "$UNCOMMITTED" -gt 0 ]; then
    echo "## Uncommitted Changes ($UNCOMMITTED files)"
    echo ""
    git status --short
    echo ""

    echo "## Diff Summary"
    echo ""
    git diff --stat
    echo ""
  fi

  # Tests status (if available)
  if [ -f "package.json" ]; then
    echo "## Test Status"
    echo ""
    if npm run test --if-present 2>&1 | tail -5 | grep -q "passed\|passing"; then
      echo "✅ Tests passing"
    else
      echo "⚠️  Check tests: npm test"
    fi
    echo ""
  fi

  # Quality status (if available)
  if [ -f ".qualityrc.json" ]; then
    LAST_LEVEL=$(jq -r '.history.runs[-1].level // "unknown"' .qualityrc.json)
    LAST_COVERAGE=$(jq -r '.history.runs[-1].coverage // "unknown"' .qualityrc.json)
    echo "## Quality Status"
    echo ""
    echo "Last quality level: $LAST_LEVEL%"
    echo "Coverage: $LAST_COVERAGE%"
    echo ""
  fi

  echo "**Next steps:**"
  echo "  /bs:resume        # Full session restore"
  echo "  /bs:quality       # Run quality loop"
  echo "  /bs:dev           # Continue development"
fi
```

### Step 5: Mode - History

```bash
if [ "$MODE" = "history" ]; then
  echo "📚 Checkpoint History"
  echo ""

  # List saved checkpoints
  if [ -d "$CHECKPOINTS_DIR" ]; then
    echo "## Saved Checkpoints"
    echo ""
    echo "| Timestamp | Branch | Reason |"
    echo "|-----------|--------|--------|"

    for checkpoint in $(ls -t "$CHECKPOINTS_DIR"/*.json 2>/dev/null); do
      if [ -f "$checkpoint" ]; then
        TIMESTAMP=$(jq -r '.timestamp // "unknown"' "$checkpoint" | cut -c1-19)
        BRANCH=$(jq -r '.branch // "unknown"' "$checkpoint")
        REASON=$(jq -r '.reason // "manual"' "$checkpoint")
        FILENAME=$(basename "$checkpoint")

        echo "| $TIMESTAMP | $BRANCH | $REASON |"
      fi
    done

    echo ""
  else
    echo "No checkpoint history found."
    echo ""
  fi

  # List sessions
  if [ -d "$SESSIONS_DIR" ]; then
    SESSION_COUNT=$(ls -1 "$SESSIONS_DIR" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$SESSION_COUNT" -gt 0 ]; then
      echo "## Saved Sessions ($SESSION_COUNT)"
      echo ""
      echo "| Session | Created |"
      echo "|---------|---------|"

      for session in $(ls -t "$SESSIONS_DIR" 2>/dev/null | head -10); do
        if [ -d "$SESSIONS_DIR/$session" ]; then
          CREATED=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$SESSIONS_DIR/$session" 2>/dev/null || stat -c "%y" "$SESSIONS_DIR/$session" 2>/dev/null | cut -d'.' -f1)
          echo "| $session | $CREATED |"
        fi
      done

      echo ""
    fi
  fi

  # Show how to restore
  echo "**To restore:**"
  echo "  /bs:context --recover         # Latest checkpoint"
  echo "  /bs:resume                    # Auto-detect best restore"
  echo "  /bs:session load <name>       # Specific session"
fi
```

## Flags

| Flag        | Description                          |
| ----------- | ------------------------------------ |
| `--recover` | Restore last checkpoint context      |
| `--diff`    | Show what changed since last session |
| `--history` | List all checkpoints and sessions    |

## When to Use

**After `/compact`:**

```bash
# Realized important context was lost
/bs:context --recover
```

**Morning standup:**

```bash
# What did I do yesterday?
/bs:context --diff
```

**After crash or timeout:**

```bash
# Quick recovery
/bs:context --recover
# Or full session restore
/bs:resume
```

## Auto-Checkpoint Integration

The following commands automatically create checkpoints:

- `/bs:ralph-dev` - Before each `/compact`
- `/bs:quality --merge` - After successful merge
- `/bs:session save --quick` - Manual checkpoint

## See Also

- `/bs:resume` - Full session restore (smarter auto-detection)
- `/bs:session` - Session management
- `/bs:dashboard` - System health overview
