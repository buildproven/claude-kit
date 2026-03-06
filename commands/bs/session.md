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

Manage agent sessions for long-running tasks that need to be paused and resumed with full context. Supports both full sessions (multi-day) and quick saves (short breaks).

## Why Session Management?

**From agent-native research:**

- Long tasks can be interrupted (mobile, battery, timeouts)
- Need checkpoint/resume patterns for reliable automation
- Session context enables multi-day workflows
- File-first architecture for inspectability and portability

**Use cases:**

- Resume work after interruption
- Hand off context between sessions
- Preserve exploration findings for later
- Multi-day feature development

## Commands

### List Sessions

```bash
/bs:session list
# or just
/bs:session
```

Shows all saved sessions with:

- Session ID
- Created date
- Description
- File count
- Size

### Save Current Session

```bash
/bs:session save "feature-dark-mode"
# or auto-generate ID
/bs:session save
# Quick save for short breaks
/bs:session save --quick
```

#### Full Save (default)

Saves current context to `data/sessions/{session-id}/`:

- Conversation summary
- Recent file changes
- Todo list state
- Key decisions made
- Next steps

**What gets saved:**

- Recent messages (last 20-30)
- Files read/modified in session
- TodoWrite state
- Branch information
- Exploration findings

**What doesn't get saved:**

- Entire conversation (too large)
- Compiled assets
- node_modules or similar

#### Quick Save (`--quick`)

Lightweight checkpoint for short breaks. Saves a single file to `data/context/checkpoint.md` (auto-overwrites previous checkpoint).

**What gets saved:**

- Current branch
- Current task (one-line status)
- Next steps (5-7 items max)
- Quick context (2-3 bullets of what's done)
- Files being worked on

Keep it under 20 lines - just essentials.

### Quick Save vs Full Save

| Feature      | `save --quick`                 | `save` (full)                  |
| ------------ | ------------------------------ | ------------------------------ |
| **Purpose**  | Quick breaks (lunch, meetings) | Multi-day workflows            |
| **Storage**  | Single file, auto-overwrites   | Multiple sessions, named       |
| **Context**  | Minimal (next steps only)      | Full (decisions, files, todos) |
| **Use case** | "BRB in 1 hour"                | "Pause for 3 days"             |
| **Files**    | 1 checkpoint file              | 4 checkpoint files             |
| **Speed**    | 5 seconds                      | 30 seconds                     |

### Load Session

```bash
/bs:session load dark-mode-session
# Load quick checkpoint
/bs:session load --quick
```

#### Full Load (default)

Restores session context:

1. Reads session checkpoint file
2. Summarizes previous work
3. Loads todo list state
4. Lists next steps
5. Ready to continue

**Agent receives:**

```markdown
## Resumed Session: dark-mode-session

**Previous Work:**

- Implemented theme toggle component
- Updated context providers
- Created dark mode CSS variables

**Files Modified:**

- src/components/ThemeToggle.tsx (new)
- src/context/ThemeContext.tsx (modified)
- src/styles/themes.css (new)

**Todo State:**

- ✅ Create theme toggle component
- ✅ Update theme context
- ⏳ Update existing components to use theme
- ⏳ Add theme persistence to localStorage
- ⏳ Test theme switching

**Next Steps:**
Continue from: "Update existing components to use theme"

Ready to resume work.
```

#### Quick Load (`--quick`)

Restores last quick checkpoint from `data/context/checkpoint.md`:

1. Reads checkpoint file
2. Displays to user
3. Asks: "Ready to continue with: [next step]?"
4. Resumes work immediately

### Delete Session

```bash
/bs:session delete dark-mode-session
```

Removes session checkpoint files.

## Implementation

### Step 0: Ensure Working Directory is Git Root

```bash
# Find git root and cd to it
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

if [[ -z "$GIT_ROOT" ]]; then
  echo "❌ Not in a git repository"
  exit 1
fi

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
  "testsStatus": {
    "passing": 12,
    "failing": 0,
    "total": 12
  },
  "keyDecisions": [
    "Using CSS variables for theme values",
    "Context API for theme state management",
    "LocalStorage for persistence"
  ]
}
```

### context.md

```markdown
# Dark Mode Implementation Session

**Started:** 2026-01-16 10:30 AM
**Branch:** feature/dark-mode

## What We Built

1. **Theme Toggle Component** (src/components/ThemeToggle.tsx)
   - Switch component with sun/moon icons
   - Integrated with theme context
   - Accessible keyboard navigation

2. **Theme Context** (src/context/ThemeContext.tsx)
   - Provider wraps app
   - useTheme hook for consumers
   - State management for light/dark mode

3. **CSS Variables** (src/styles/themes.css)
   - --bg-primary, --text-primary, etc.
   - Light and dark theme definitions
   - Smooth transition animations

## Key Decisions

- **CSS Variables over styled-components**: Better performance, simpler
- **Context API over Redux**: Lightweight, sufficient for theme state
- **LocalStorage persistence**: Standard pattern, widely supported

## What's Left

- [ ] Update 15+ existing components to use theme variables
- [ ] Add localStorage sync on theme change
- [ ] Test theme switching across all pages
- [ ] Update Storybook stories

## Notes

- Found some hardcoded colors in Button.tsx that need updating
- May want to add system preference detection later
- Consider adding more theme options (high contrast, etc.)
```

## Bash Implementation

```bash
#!/bin/bash

ACTION="${1:-list}"
SESSION_ID="$2"
SESSIONS_DIR="data/sessions"
CHECKPOINT_FILE="data/context/checkpoint.md"

# Check for --quick flag and --reason
QUICK=false
REASON=""
for arg in "$@"; do
  if [ "$arg" = "--quick" ]; then
    QUICK=true
  fi
done
# Extract --reason value
for i in "${!@}"; do
  if [[ "${!i}" == "--reason" ]]; then
    j=$((i + 1))
    REASON="${!j}"
  fi
done

case "$ACTION" in
  list)
    echo "📋 Saved Sessions:"
    echo ""
    # Show quick checkpoint if exists
    if [ -f "$CHECKPOINT_FILE" ]; then
      echo "  [quick] checkpoint"
      echo "    File: $CHECKPOINT_FILE"
      echo "    Modified: $(stat -f "%Sm" "$CHECKPOINT_FILE")"
      echo ""
    fi
    if [ -d "$SESSIONS_DIR" ]; then
      for dir in "$SESSIONS_DIR"/*; do
        if [ -f "$dir/checkpoint.json" ]; then
          SESSION=$(basename "$dir")
          DESCRIPTION=$(jq -r '.description' "$dir/checkpoint.json")
          CREATED=$(jq -r '.created' "$dir/checkpoint.json")
          echo "  $SESSION"
          echo "    Description: $DESCRIPTION"
          echo "    Created: $CREATED"
          echo ""
        fi
      done
    else
      echo "  No full sessions found. Use '/bs:session save' to create one."
    fi
    ;;

  save)
    if [ "$QUICK" = true ]; then
      echo "💾 Quick saving checkpoint..."
      mkdir -p "data/context"
      mkdir -p "data/context/history"

      # Archive existing checkpoint to history before overwriting
      if [ -f "$CHECKPOINT_FILE" ]; then
        ARCHIVE_NAME="checkpoint-$(date +%Y%m%d-%H%M%S).md"
        cp "$CHECKPOINT_FILE" "data/context/history/$ARCHIVE_NAME"
        echo "📁 Archived previous checkpoint to history/$ARCHIVE_NAME"
      fi

      echo "Creating checkpoint at $CHECKPOINT_FILE"
      if [ -n "$REASON" ]; then
        echo "Reason: $REASON"
      fi
      echo ""
      echo "Claude: Please create a checkpoint file with:"
      echo "  - Current branch"
      echo "  - Current task"
      if [ -n "$REASON" ]; then
        echo "  - Checkpoint reason: $REASON"
      fi
      echo "  - Next steps (numbered list)"
      echo "  - Quick context (what's done, what's in progress)"
      echo "  - Files being worked on"
      echo ""
      echo "Keep it brief - just enough to resume work (under 20 lines)."
    else
      # Generate session ID if not provided
      if [ -z "$SESSION_ID" ]; then
        SESSION_ID="session-$(date +%Y%m%d-%H%M%S)"
      fi

      mkdir -p "$SESSIONS_DIR/$SESSION_ID"

      echo "💾 Saving session: $SESSION_ID"
      echo ""
      echo "Please create checkpoint files in $SESSIONS_DIR/$SESSION_ID/:"
      echo "  - checkpoint.json (session metadata)"
      echo "  - context.md (human-readable summary)"
      echo "  - todos.json (current TodoWrite state)"
      echo "  - files.json (list of modified files)"
    fi
    ;;

  load)
    if [ "$QUICK" = true ]; then
      if [ ! -f "$CHECKPOINT_FILE" ]; then
        echo "❌ No quick checkpoint found"
        echo ""
        echo "Create one with: /bs:session save --quick"
        exit 1
      fi

      echo "📂 Loading quick checkpoint..."
      echo ""
      cat "$CHECKPOINT_FILE"
      echo ""
      echo "---"
      echo "✅ Checkpoint restored. Ready to continue."
    else
      if [ -z "$SESSION_ID" ]; then
        echo "❌ Error: Session ID required"
        echo "Usage: /bs:session load <session-id>"
        echo "   or: /bs:session load --quick"
        exit 1
      fi

      if [ ! -d "$SESSIONS_DIR/$SESSION_ID" ]; then
        echo "❌ Error: Session not found: $SESSION_ID"
        echo "Available sessions:"
        /bs:session list
        exit 1
      fi

      echo "📂 Loading session: $SESSION_ID"
      echo ""

      echo "Reading checkpoint from $SESSIONS_DIR/$SESSION_ID/"
      echo "Claude will restore context and continue work."
    fi
    ;;

  clear)
    # Clear quick checkpoint
    if [ ! -f "$CHECKPOINT_FILE" ]; then
      echo "No quick checkpoint to clear"
      exit 0
    fi

    echo "🗑️  Clearing quick checkpoint..."
    rm "$CHECKPOINT_FILE"
    echo "✅ Quick checkpoint cleared"
    ;;

  delete)
    if [ -z "$SESSION_ID" ]; then
      echo "❌ Error: Session ID required"
      echo "Usage: /bs:session delete <session-id>"
      exit 1
    fi

    if [ ! -d "$SESSIONS_DIR/$SESSION_ID" ]; then
      echo "❌ Error: Session not found: $SESSION_ID"
      exit 1
    fi

    echo "🗑️  Deleting session: $SESSION_ID"
    rm -rf "$SESSIONS_DIR/$SESSION_ID"
    echo "✅ Session deleted"
    ;;

  *)
    echo "❌ Unknown action: $ACTION"
    echo ""
    echo "Usage: /bs:session [list|save|load|delete|clear] [session-id] [--quick]"
    echo ""
    echo "Examples:"
    echo "  /bs:session list              # List all sessions"
    echo "  /bs:session save              # Save current session (auto ID)"
    echo "  /bs:session save my-feature   # Save with custom ID"
    echo "  /bs:session save --quick      # Quick save for short breaks"
    echo "  /bs:session load my-feature   # Resume previous session"
    echo "  /bs:session load --quick      # Load quick checkpoint"
    echo "  /bs:session clear             # Clear quick checkpoint"
    echo "  /bs:session delete my-feature # Delete session"
    exit 1
    ;;
esac
```

## Agent Instructions

### On Full Save (`/bs:session save`)

1. **Create checkpoint.json**
   - Session metadata
   - Current branch
   - Summary of work done
   - Next steps list
   - Last active timestamp
   - Files in progress (currently editing)
   - Files modified (completed changes)
   - Last command run
   - Tests status (passing/failing/total)

2. **Create context.md**
   - Human-readable session summary
   - What was built
   - Key decisions made
   - What's remaining

3. **Create todos.json**
   - Current TodoWrite state
   - Preserves progress tracking

4. **Create files.json**
   - List of files modified in session
   - Brief description of changes

### On Quick Save (`/bs:session save --quick`)

Create a brief checkpoint at `data/context/checkpoint.md` with:

1. Current branch name
2. One-line status
3. Numbered next steps (5-7 items max)
4. Quick context (2-3 bullets of what's done)
5. Files currently being worked on
6. Checkpoint reason (if `--reason` provided)

Keep it under 20 lines - just essentials.

**With `--reason` flag:**

```bash
/bs:session save --quick --reason "pre-compact checkpoint"
```

Include the reason in the checkpoint file header for context on why it was created.

### Checkpoint History (Auto-Archive)

Quick saves automatically archive previous checkpoints to `data/context/history/`:

```
data/context/
├── checkpoint.md                      # Current checkpoint (overwritten each save)
└── history/
    ├── checkpoint-20260203-143022.md  # Previous checkpoints (timestamped)
    ├── checkpoint-20260203-151530.md
    └── ...
```

**Recovery from history:**

```bash
# List available checkpoints
ls data/context/history/

# View a specific checkpoint
cat data/context/history/checkpoint-20260203-143022.md

# Restore an old checkpoint (manual)
cp data/context/history/checkpoint-20260203-143022.md data/context/checkpoint.md
/bs:session load --quick
```

### On Full Load (`/bs:session load <id>`)

1. **Read all checkpoint files**
2. **Summarize previous work** for the user
3. **Restore TodoWrite state**
4. **List next steps clearly**
5. **Ask user**: "Ready to continue from [next step]?"

### On Quick Load (`/bs:session load --quick`)

1. Read checkpoint file
2. Display to user
3. Ask: "Ready to continue with: [next step]?"
4. Resume work immediately

## Benefits

**From agent-native research:**

- ✅ Checkpoint/resume pattern for reliable automation
- ✅ File-first architecture for inspectability
- ✅ Context preserved across interruptions
- ✅ Enables multi-day workflows
- ✅ Device synchronization via iCloud/Git

**Practical benefits:**

- Work on multiple features in parallel
- Pause work without losing context
- Hand off to teammates with full context
- Resume after days/weeks with clarity

## Integration with Workflow

```bash
# Quick break (lunch, meeting)
/bs:dev dark-mode
# ... work for 1 hour ...
/bs:session save --quick
# After break
/bs:session load --quick
# Continue immediately

# Multi-day feature
/bs:dev dark-mode
# ... work for 2 hours ...
/bs:session save
# End day

# Day 2: Resume
/bs:session load dark-mode
# Continue where you left off
/bs:quality --merge
# Ship it

# Cleanup
/bs:session delete dark-mode
```

## See Also

- `/bs:resume` - Resume last session or quick checkpoint (shortcut)
- `/bs:dev` - Start development work
- `/bs:quality` - Ship when done
