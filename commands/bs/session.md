---
name: bs:session
description: Manage agent sessions for continuation and context preservation
argument-hint: '[list|save|load|delete] [session-id] → manage sessions'
tags: [agents, workflow, session-management]
category: agents
model: haiku
---

# /bs:session - Agent Session Management

**Usage**: `/bs:session [list|save|load|delete] [session-id] [--quick]`

## Commands

```bash
/bs:session list                  # List all sessions
/bs:session save "feature-name"   # Save full session
/bs:session save                  # Auto-generate session ID
/bs:session save --quick          # Quick save (short breaks)
/bs:session load dark-mode-session
/bs:session load --quick          # Load quick checkpoint
/bs:session delete dark-mode-session
```

### Quick Save vs Full Save

| Feature     | `save --quick`                 | `save` (full)                  |
| ----------- | ------------------------------ | ------------------------------ |
| **Purpose** | Quick breaks (lunch, meetings) | Multi-day workflows            |
| **Storage** | Single file, auto-overwrites   | Multiple sessions, named       |
| **Context** | Minimal (next steps only)      | Full (decisions, files, todos) |
| **Files**   | 1 checkpoint file              | 4 checkpoint files             |
| **Speed**   | 5 seconds                      | 30 seconds                     |

Quick save: `data/context/checkpoint.md` (max 20 lines — just essentials)
Full save: `data/sessions/{session-id}/` with checkpoint.json, context.md, todos.json, files.json

## Implementation

### Step 0: Ensure Git Root

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[[ -z "$GIT_ROOT" ]] && echo "❌ Not in a git repository" && exit 1
cd "$GIT_ROOT"
```

### Session File Structure

```
data/sessions/
├── dark-mode-2026-01-16/
│   ├── checkpoint.json        # Main session data
│   ├── context.md             # Human-readable summary
│   ├── todos.json             # TodoWrite state
│   └── files.json             # Modified files list
```

### checkpoint.json

```json
{
  "id": "dark-mode-2026-01-16",
  "description": "Dark mode implementation",
  "created": "2026-01-16T10:30:00Z",
  "lastActive": "2026-01-16T14:45:00Z",
  "branch": "feature/dark-mode",
  "status": "in_progress",
  "summary": "Implementing dark mode toggle with theme context",
  "nextSteps": [
    "Update existing components to use theme",
    "Add theme persistence",
    "Test theme switching"
  ],
  "filesModified": [
    "src/components/ThemeToggle.tsx",
    "src/context/ThemeContext.tsx"
  ],
  "filesInProgress": ["src/styles/themes.css", "src/components/Header.tsx"],
  "lastCommand": "/bs:dev dark-mode",
  "testsStatus": { "passing": 12, "failing": 0, "total": 12 },
  "keyDecisions": [
    "Using CSS variables for theme values",
    "Context API for theme state management"
  ]
}
```

## Bash Implementation

```bash
#!/bin/bash

ACTION="${1:-list}"
SESSION_ID="$2"
SESSIONS_DIR="data/sessions"
CHECKPOINT_FILE="data/context/checkpoint.md"

QUICK=false
REASON=""
for arg in "$@"; do
  [ "$arg" = "--quick" ] && QUICK=true
done
for i in "${!@}"; do
  if [[ "${!i}" == "--reason" ]]; then
    j=$((i + 1)); REASON="${!j}"
  fi
done

case "$ACTION" in
  list)
    echo "📋 Saved Sessions:"
    if [ -f "$CHECKPOINT_FILE" ]; then
      echo "  [quick] checkpoint"
      echo "    File: $CHECKPOINT_FILE"
      echo "    Modified: $(stat -f "%Sm" "$CHECKPOINT_FILE")"
    fi
    if [ -d "$SESSIONS_DIR" ]; then
      for dir in "$SESSIONS_DIR"/*; do
        if [ -f "$dir/checkpoint.json" ]; then
          SESSION=$(basename "$dir")
          echo "  $SESSION"
          echo "    Description: $(jq -r '.description' "$dir/checkpoint.json")"
          echo "    Created: $(jq -r '.created' "$dir/checkpoint.json")"
        fi
      done
    else
      echo "  No full sessions found. Use '/bs:session save' to create one."
    fi
    ;;

  save)
    if [ "$QUICK" = true ]; then
      mkdir -p "data/context" "data/context/history"
      if [ -f "$CHECKPOINT_FILE" ]; then
        ARCHIVE_NAME="checkpoint-$(date +%Y%m%d-%H%M%S).md"
        cp "$CHECKPOINT_FILE" "data/context/history/$ARCHIVE_NAME"
        echo "📁 Archived previous checkpoint to history/$ARCHIVE_NAME"
      fi
      echo "Claude: Please create a checkpoint file at $CHECKPOINT_FILE with:"
      echo "  - Current branch"
      echo "  - Current task"
      [ -n "$REASON" ] && echo "  - Checkpoint reason: $REASON"
      echo "  - Next steps (numbered list)"
      echo "  - Quick context (what's done, what's in progress)"
      echo "  - Files being worked on"
      echo "Keep it under 20 lines."
    else
      [ -z "$SESSION_ID" ] && SESSION_ID="session-$(date +%Y%m%d-%H%M%S)"
      mkdir -p "$SESSIONS_DIR/$SESSION_ID"
      echo "💾 Saving session: $SESSION_ID"
      echo "Create checkpoint files in $SESSIONS_DIR/$SESSION_ID/:"
      echo "  - checkpoint.json, context.md, todos.json, files.json"
    fi
    ;;

  load)
    if [ "$QUICK" = true ]; then
      [ ! -f "$CHECKPOINT_FILE" ] && echo "❌ No quick checkpoint found. Run /bs:session save --quick" && exit 1
      cat "$CHECKPOINT_FILE"
      echo "✅ Checkpoint restored. Ready to continue."
    else
      [ -z "$SESSION_ID" ] && echo "❌ Session ID required" && exit 1
      [ ! -d "$SESSIONS_DIR/$SESSION_ID" ] && echo "❌ Session not found: $SESSION_ID" && exit 1
      echo "📂 Loading session: $SESSION_ID"
      echo "Reading checkpoint from $SESSIONS_DIR/$SESSION_ID/"
    fi
    ;;

  clear)
    [ ! -f "$CHECKPOINT_FILE" ] && echo "No quick checkpoint to clear" && exit 0
    rm "$CHECKPOINT_FILE"
    echo "✅ Quick checkpoint cleared"
    ;;

  delete)
    [ -z "$SESSION_ID" ] && echo "❌ Session ID required" && exit 1
    [ ! -d "$SESSIONS_DIR/$SESSION_ID" ] && echo "❌ Session not found: $SESSION_ID" && exit 1
    rm -rf "$SESSIONS_DIR/$SESSION_ID"
    echo "✅ Session deleted"
    ;;

  *)
    echo "❌ Unknown action: $ACTION"
    echo "Usage: /bs:session [list|save|load|delete|clear] [session-id] [--quick]"
    exit 1
    ;;
esac
```

## Agent Instructions

### On Full Save (`/bs:session save`)

1. **checkpoint.json**: session metadata, branch, summary, next steps, last active, files in/modified, last command, test status
2. **context.md**: human-readable summary of what was built, key decisions, what's remaining
3. **todos.json**: current TodoWrite state
4. **files.json**: list of files modified with brief change description

### On Quick Save (`/bs:session save --quick`)

Create `data/context/checkpoint.md` with: branch name, one-line status, numbered next steps (5-7 max), quick context (2-3 bullets), files in progress. Include `--reason` in header if provided. Keep under 20 lines.

### Checkpoint History (Auto-Archive)

Quick saves auto-archive previous to `data/context/history/` (timestamped). To restore: `cp data/context/history/<timestamp>.md data/context/checkpoint.md` then `/bs:session load --quick`

### On Full Load (`/bs:session load <id>`)

1. Read all checkpoint files
2. Summarize previous work for user
3. Restore TodoWrite state
4. List next steps clearly
5. Ask: "Ready to continue from [next step]?"

### On Quick Load (`/bs:session load --quick`)

1. Read and display checkpoint file
2. Ask: "Ready to continue with: [next step]?"
3. Resume work immediately

## Persistent Sessions via acpx

For context that must survive `/clear` and full CC restarts, use `acpx` named sessions. Unlike `/bs:session` (which stores context in files you load manually), `acpx` sessions are managed by acpx itself — state persists at the process level, not in the CC context window.

### Starting a named session

```bash
acpx claude -s "feat/my-feature" "Continue implementing [task]. Previous context: [summary]"
```

The `-s` flag names the session. acpx resumes the existing session if the name matches, or creates a new one.

### Naming conventions

| Prefix      | Use case                   | Example                 |
| ----------- | -------------------------- | ----------------------- |
| `feat/`     | Feature branch work        | `feat/dark-mode`        |
| `debug/`    | Debugging a specific issue | `debug/CS-42`           |
| `ralph/`    | Ralph autonomous sessions  | `ralph/2026-03-11`      |
| `refactor/` | Multi-session refactors    | `refactor/auth-cleanup` |

Match the session name to the git branch when possible — makes it obvious which session maps to which work.

### Listing active sessions

```bash
acpx sessions list
```

### Resuming a session

```bash
acpx claude -s "feat/my-feature" "Resume where we left off"
```

acpx reconnects to the named session. Provide a short resume prompt — CC still needs the intent, even though acpx carries the state.

### When to use acpx sessions vs /bs:session

| Scenario                                          | Use                        |
| ------------------------------------------------- | -------------------------- |
| Quick break (lunch, meeting)                      | `/bs:session save --quick` |
| Multi-day feature, resuming next morning          | `/bs:session save`         |
| Long refactor across multiple `/clear`s           | `acpx -s "refactor/..."`   |
| Background work running while you do other things | `acpx -s "..."`            |
| Need to switch tasks mid-session and come back    | `acpx -s "feat/..."`       |

**Rule of thumb**: if you're about to `/clear` and expect to return to the same task, use acpx named sessions. If you're done for the day and want a human-readable checkpoint, use `/bs:session save`.
