---
name: bs:context
description: 'Context recovery - restore checkpoints, show diffs, view history'
argument-hint: '[--recover] [--diff] [--history] [--save] [--resume] → manage context state'
tags: [context, recovery, session]
category: agents
model: haiku
---

# /bs:context - Context Recovery

**Usage**: `/bs:context [--recover] [--diff] [--history] [--save] [--resume]`

## Quick Reference

```bash
/bs:context                 # Show current context state
/bs:context --recover       # Restore last checkpoint
/bs:context --diff          # Show changes since last session
/bs:context --history       # List all checkpoints
/bs:context --save          # Save current task state to .claude/SESSION.md (before /clear)
/bs:context --resume        # Load .claude/SESSION.md — resume exactly where you left off
```

## Implementation

### Step 1: Parse Arguments

```bash
#!/usr/bin/env bash
set -euo pipefail

MODE="status"

for arg in "$@"; do
  case "$arg" in
    --recover) MODE="recover" ;;
    --diff)    MODE="diff" ;;
    --history) MODE="history" ;;
    --save)    MODE="save" ;;
    --resume)  MODE="resume" ;;
  esac
done

CHECKPOINT_FILE="data/context/checkpoint.md"
CHECKPOINT_JSON="data/context/checkpoint.json"
CHECKPOINTS_DIR="data/context/history"
SESSIONS_DIR="data/sessions"

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
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  UNCOMMITTED=$(git status --short | wc -l | tr -d ' ')

  echo "**Branch:** $CURRENT_BRANCH"
  echo "**Uncommitted files:** $UNCOMMITTED"

  if [ -f "$CHECKPOINT_FILE" ]; then
    CHECKPOINT_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$CHECKPOINT_FILE" 2>/dev/null || stat -c "%y" "$CHECKPOINT_FILE" 2>/dev/null | cut -d'.' -f1)
    echo "**Quick checkpoint:** Available (saved $CHECKPOINT_TIME)"
  else
    echo "**Quick checkpoint:** None"
  fi

  if [ -d "$SESSIONS_DIR" ]; then
    SESSION_COUNT=$(ls -1 "$SESSIONS_DIR" 2>/dev/null | wc -l | tr -d ' ')
    [ "$SESSION_COUNT" -gt 0 ] && LATEST=$(ls -t "$SESSIONS_DIR" | head -1) && echo "**Sessions:** $SESSION_COUNT (latest: $LATEST)" || echo "**Sessions:** None"
  else
    echo "**Sessions:** None"
  fi

  [ -d "$CHECKPOINTS_DIR" ] && echo "**Checkpoint history:** $(ls -1 "$CHECKPOINTS_DIR" | wc -l | tr -d ' ') saved" || echo "**Checkpoint history:** None"

  echo ""
  echo "  /bs:context --recover   # Restore last checkpoint"
  echo "  /bs:context --diff      # See what changed"
  echo "  /bs:context --history   # Browse checkpoints"
fi
```

### Step 3: Mode - Recover

```bash
if [ "$MODE" = "recover" ]; then
  if [ -f "$CHECKPOINT_JSON" ]; then
    BRANCH=$(jq -r '.branch // "unknown"' "$CHECKPOINT_JSON")
    FILES_IN_PROGRESS=$(jq -r '.filesInProgress[]? // empty' "$CHECKPOINT_JSON" | head -5)
    NEXT_STEPS=$(jq -r '.nextSteps[]? // empty' "$CHECKPOINT_JSON" | head -3)
    LAST_COMMAND=$(jq -r '.lastCommand // "unknown"' "$CHECKPOINT_JSON")

    echo "Branch: $BRANCH"
    [ -n "$FILES_IN_PROGRESS" ] && echo "Files in progress:" && echo "$FILES_IN_PROGRESS" | sed 's/^/  - /'
    [ -n "$NEXT_STEPS" ] && echo "Next steps:" && echo "$NEXT_STEPS" | sed 's/^/  - /'
    echo "Last command: $LAST_COMMAND"

    git status --short
    git diff --quiet HEAD 2>/dev/null || git diff --stat

    echo "✅ Context restored. Use /bs:resume for full session restore."

  elif [ -f "$CHECKPOINT_FILE" ]; then
    cat "$CHECKPOINT_FILE"
    echo "✅ Checkpoint content displayed above."

  elif [ -d "$SESSIONS_DIR" ]; then
    LATEST_SESSION=$(ls -t "$SESSIONS_DIR" 2>/dev/null | head -1)
    if [ -n "$LATEST_SESSION" ]; then
      [ -f "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json" ] && jq '.' "$SESSIONS_DIR/$LATEST_SESSION/checkpoint.json" || cat "$SESSIONS_DIR/$LATEST_SESSION/context.md"
      echo "✅ Session context displayed. Use /bs:resume $LATEST_SESSION for full restore."
    else
      echo "❌ No checkpoints or sessions found"; exit 1
    fi
  else
    echo "❌ No checkpoints or sessions found"
    echo "Create a checkpoint with: /bs:session save --quick"
    exit 1
  fi
fi
```

### Step 4: Mode - Diff

```bash
if [ "$MODE" = "diff" ]; then
  LAST_CHECKPOINT=""
  [ -f "$CHECKPOINT_JSON" ] && LAST_CHECKPOINT=$(jq -r '.timestamp // empty' "$CHECKPOINT_JSON")
  [ -z "$LAST_CHECKPOINT" ] && [ -f "$CHECKPOINT_FILE" ] && LAST_CHECKPOINT=$(stat -f "%Sm" -t "%Y-%m-%dT%H:%M:%S" "$CHECKPOINT_FILE" 2>/dev/null || stat -c "%y" "$CHECKPOINT_FILE" 2>/dev/null)
  [ -z "$LAST_CHECKPOINT" ] && echo "⚠️  No checkpoint found. Showing recent changes." && LAST_CHECKPOINT="1 day ago"

  echo "**Since:** $LAST_CHECKPOINT"
  echo "## Commits"
  git log --oneline --since="$LAST_CHECKPOINT" 2>/dev/null || git log --oneline -10

  echo "## Files Changed"
  git diff --stat HEAD~10...HEAD 2>/dev/null || git diff --stat

  UNCOMMITTED=$(git status --short | wc -l | tr -d ' ')
  if [ "$UNCOMMITTED" -gt 0 ]; then
    echo "## Uncommitted Changes ($UNCOMMITTED files)"
    git status --short
    git diff --stat
  fi

  if [ -f "package.json" ]; then
    npm run test --if-present 2>&1 | tail -5 | grep -q "passed\|passing" && echo "✅ Tests passing" || echo "⚠️  Check tests: npm test"
  fi

  if [ -f ".qualityrc.json" ]; then
    echo "Last quality level: $(jq -r '.history.runs[-1].level // "unknown"' .qualityrc.json)%"
    echo "Coverage: $(jq -r '.history.runs[-1].coverage // "unknown"' .qualityrc.json)%"
  fi

  echo "  /bs:resume        # Full session restore"
  echo "  /bs:quality       # Run quality loop"
fi
```

### Step 5: Mode - History

```bash
if [ "$MODE" = "history" ]; then
  if [ -d "$CHECKPOINTS_DIR" ]; then
    echo "| Timestamp | Branch | Reason |"
    echo "|-----------|--------|--------|"
    for checkpoint in $(ls -t "$CHECKPOINTS_DIR"/*.json 2>/dev/null); do
      [ -f "$checkpoint" ] && echo "| $(jq -r '.timestamp // "unknown"' "$checkpoint" | cut -c1-19) | $(jq -r '.branch // "unknown"' "$checkpoint") | $(jq -r '.reason // "manual"' "$checkpoint") |"
    done
  else
    echo "No checkpoint history found."
  fi

  if [ -d "$SESSIONS_DIR" ] && [ "$(ls -1 "$SESSIONS_DIR" | wc -l | tr -d ' ')" -gt 0 ]; then
    echo "| Session | Created |"
    echo "|---------|---------|"
    for session in $(ls -t "$SESSIONS_DIR" | head -10); do
      [ -d "$SESSIONS_DIR/$session" ] && echo "| $session | $(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$SESSIONS_DIR/$session" 2>/dev/null || stat -c "%y" "$SESSIONS_DIR/$session" 2>/dev/null | cut -d'.' -f1) |"
    done
  fi

  echo "  /bs:context --recover         # Latest checkpoint"
  echo "  /bs:resume                    # Auto-detect best restore"
  echo "  /bs:session load <name>       # Specific session"
fi
```

## Flags

| Flag        | Description                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `--recover` | Restore last checkpoint context                                                                     |
| `--diff`    | Show what changed since last session                                                                |
| `--history` | List all checkpoints and sessions                                                                   |
| `--save`    | Write `.claude/SESSION.md` — current task, files, next step (use before /compact or ending session) |
| `--resume`  | Load `.claude/SESSION.md` — pick up exactly where you left off                                      |

### Step 6: Mode - Save

```bash
if [ "$MODE" = "save" ]; then
  SESSION_FILE=".claude/SESSION.md"
  mkdir -p .claude

  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  CHANGED=$(git diff --name-only; git diff --cached --name-only)
  RECENT_COMMITS=$(git log --oneline -5)
  DATE=$(date +"%Y-%m-%d %H:%M")

  cat > "$SESSION_FILE" <<SESSIONEOF
# Session Handoff — $DATE

**Branch:** $BRANCH

## Current Task
$(echo "$BRANCH" | sed 's|.*/||' | tr '-' ' ')

## Files in Play
$(echo "$CHANGED" | sed 's/^/- /' | head -20)

## Recent Commits
$(echo "$RECENT_COMMITS" | sed 's/^/- /')

## Decisions Made
<!-- Key decisions that a fresh agent should know -->

## Next Step
<!-- Exactly where to resume — be specific -->

## Notes / Gotchas
<!-- Anything that surprised you or will trip up a fresh agent -->
SESSIONEOF

  echo "✅ Session saved to $SESSION_FILE"
  echo "   Edit it to add decisions + next step, then run /bs:context --resume in a new session."
fi
```

### Step 7: Mode - Resume

```bash
if [ "$MODE" = "resume" ]; then
  SESSION_FILE=".claude/SESSION.md"

  if [ ! -f "$SESSION_FILE" ]; then
    echo "❌ No session file found at $SESSION_FILE"
    echo "   Run /bs:context --save at the end of a session to create one."
    exit 1
  fi

  cat "$SESSION_FILE"
  echo "---"
  git status --short
  echo "✅ Context loaded. Continue from 'Next Step' above."
fi
```

## Auto-Checkpoint Integration

These commands automatically create checkpoints:

- `/bs:ralph` - Before major context compression points
- `/bs:quality --merge` - After successful merge
- `/bs:session save --quick` - Manual checkpoint
