---
model: sonnet
name: bs:agent-run
description: Run custom agents with session support and learning injection
argument-hint: '<agent-name> "task" [--session id] [--model opus|sonnet] [--use-learnings]'
tags: [agents, sdk, execution, learnings]
category: agents
---

# /bs:agent-run - Run Custom Agents

**Usage**: `/bs:agent-run <agent-name> "<task>" [--session <id>] [--model <model>] [--use-learnings [keywords]]`

## Quick Start

```bash
/bs:agent-run security-scanner "Scan authentication module"
/bs:agent-run api-tester "Test checkout API" --session checkout-tests
/bs:agent-run doc-writer "Generate API docs" --model opus
/bs:agent-run api-tester --session checkout-tests --resume
```

## Available Agents

Custom agents live in `agents/` directory (`ls agents/`).

Built-in agents (via Task tool): `Explore`, `github-issue-fixer`, `refactoring-specialist`, `security-auditor`, `accessibility-tester`, `performance-engineer`, `code-reviewer`

## Flags

```bash
--session <id>      # Create/resume session for context preservation
--resume            # Resume last session (requires --session)
--model <model>     # Use specific model (sonnet, opus, haiku)
--output <file>     # Save structured output to file
--verbose           # Show agent's thinking process
--dry-run           # Preview without execution
--use-learnings [keywords]  # Inject relevant learnings into agent context
```

### Learning Injection

```bash
/bs:agent-run security-scanner "Scan auth module" --use-learnings
/bs:agent-run api-tester "Test checkout" --use-learnings "bash,validation,api"
```

Injects into agent prompt: recent session learnings from `.claude/session-learnings.md`, relevant patterns from `.claude/learning-index.json`, matching CLAUDE.md sections.

## Implementation

```bash
#!/bin/bash

AGENT_NAME="$1"
TASK="$2"
SESSION_ID=""
MODEL="sonnet"
RESUME=false
OUTPUT_FILE=""
VERBOSE=false
DRY_RUN=false
USE_LEARNINGS=false
LEARNING_KEYWORDS=""

shift 2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)    SESSION_ID="$2"; shift 2 ;;
    --resume)     RESUME=true; shift ;;
    --model)      MODEL="$2"; shift 2 ;;
    --output)     OUTPUT_FILE="$2"; shift 2 ;;
    --verbose)    VERBOSE=true; shift ;;
    --dry-run)    DRY_RUN=true; shift ;;
    --use-learnings)
      USE_LEARNINGS=true
      if [[ $# -gt 1 && ! "$2" =~ ^-- ]]; then
        LEARNING_KEYWORDS="$2"; shift
      fi
      shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

[ -z "$AGENT_NAME" ] && echo "❌ Agent name required" && exit 1
[ -z "$TASK" ] && [ "$RESUME" = false ] && echo "❌ Task required (unless --resume)" && exit 1

AGENT_DIR="agents/$AGENT_NAME"
if [ ! -d "$AGENT_DIR" ]; then
  echo "❌ Agent not found: $AGENT_NAME"
  ls agents/ 2>/dev/null || echo "  No custom agents found"
  echo "Create new agent: /bs:agent-new $AGENT_NAME"
  exit 1
fi

echo "🤖 Agent: $AGENT_NAME | Task: $TASK | Model: $MODEL"
[ -n "$SESSION_ID" ] && echo "   Session: $SESSION_ID"
[ "$USE_LEARNINGS" = true ] && echo "   Learnings: enabled${LEARNING_KEYWORDS:+ (keywords: $LEARNING_KEYWORDS)}"

if [ "$USE_LEARNINGS" = true ]; then
  SCRIPTS_DIR="${HOME}/Projects/claude-setup/scripts"
  if [ -f "$SCRIPTS_DIR/extract-learnings.sh" ]; then
    LEARNINGS_CONTEXT=$("$SCRIPTS_DIR/extract-learnings.sh" format "" "$LEARNING_KEYWORDS" 2>/dev/null || true)
    [ -n "$LEARNINGS_CONTEXT" ] && echo "   Found relevant learnings to inject" || echo "   No relevant learnings found"
  else
    echo "   Warning: extract-learnings.sh not found"
  fi
fi

if [ "$DRY_RUN" = true ]; then
  echo "🏃 Dry run - would execute but not running"
  [ -n "$LEARNINGS_CONTEXT" ] && echo "$LEARNINGS_CONTEXT"
  exit 0
fi

echo "Executing..."
```

## Agent Execution Flow

```
1. Load Agent Config (agent.ts, config.json, prompts/system.md, tools/schemas)
2. Session Management (load/create session, restore if --resume)
3. Execute Task (send to agent, stream if --verbose, collect results)
4. Output Results (structured JSON, save to --output file, save session)
```

## Session Support

```bash
# Create session (saves to data/sessions/auth-tests/)
/bs:agent-run api-tester "Test auth endpoints" --session auth-tests

# Resume
/bs:agent-run api-tester --session auth-tests --resume

# Add new task to existing session
/bs:agent-run api-tester "Now test payment endpoints" --session auth-tests
```

## Structured Output

Define schema at `agents/<name>/schemas/report.json`. Output saved as JSON matching schema:

```bash
/bs:agent-run security-scanner "Scan project" --output security-report.json
```

## Hooks for Auditing

`agents/<name>/hooks/preToolUse.ts` — block dangerous operations, log tool usage.
`agents/<name>/hooks/postToolUse.ts` — collect metrics, write audit log.
