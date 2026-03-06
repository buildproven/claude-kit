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

Execute custom agents created with `/bs:agent-new` or use built-in specialized agents. Optionally inject relevant learnings from previous sessions to provide historical context.

## Quick Start

```bash
# Run custom agent
/bs:agent-run security-scanner "Scan authentication module"

# With session (resume support)
/bs:agent-run api-tester "Test checkout API" --session checkout-tests

# With specific model
/bs:agent-run doc-writer "Generate API docs" --model opus

# Resume previous session
/bs:agent-run api-tester --session checkout-tests --resume
```

## Available Agents

### Custom Agents (Created with /bs:agent-new)

List in `agents/` directory:

```bash
ls agents/
# security-scanner/
# api-tester/
# doc-writer/
# performance-auditor/
```

### Built-in Agents (via Task tool)

- `Explore` - Codebase understanding
- `github-issue-fixer` - Fix GitHub issues
- `refactoring-specialist` - Code refactoring
- `security-auditor` - Security review
- `accessibility-tester` - A11y compliance
- `performance-engineer` - Performance optimization
- `code-reviewer` - Code review

## Flags

```bash
--session <id>      # Create/resume session for context preservation
--resume            # Resume last session (requires --session)
--model <model>     # Use specific model (sonnet, opus, haiku)
--output <file>     # Save structured output to file
--verbose           # Show agent's thinking process
--dry-run           # Preview without execution
--use-learnings [keywords]  # Inject relevant learnings into agent context (CS-073)
```

### Learning Injection (CS-073)

The `--use-learnings` flag enables historical context injection:

```bash
# Auto-detect relevant learnings based on task
/bs:agent-run security-scanner "Scan auth module" --use-learnings

# Specify keywords to find specific learnings
/bs:agent-run api-tester "Test checkout" --use-learnings "bash,validation,api"
```

When enabled, the agent receives:

- Recent session learnings from `.claude/session-learnings.md`
- Relevant patterns from `.claude/learning-index.json`
- Matching sections from CLAUDE.md based on keywords

**Format injected into prompt:**

```markdown
## Relevant Learnings

### From Previous Items

From CS-055 (cost-tracking):

- Bash 3.2 compatibility - use case statements instead of associative arrays
- jq for JSON manipulation - safe with --arg flag

### From CLAUDE.md Patterns

- Safe Parsing: Always validate external data with Zod schema
- Two-Layer Async Error Handling: Both promise .catch() AND try/catch
```

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

# Parse flags
shift 2
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      SESSION_ID="$2"
      shift 2
      ;;
    --resume)
      RESUME=true
      shift
      ;;
    --model)
      MODEL="$2"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --use-learnings)
      USE_LEARNINGS=true
      # Check if next arg is keywords (not another flag)
      if [[ $# -gt 1 && ! "$2" =~ ^-- ]]; then
        LEARNING_KEYWORDS="$2"
        shift
      fi
      shift
      ;;
    *)
      echo "Unknown flag: $1"
      exit 1
      ;;
  esac
done

# Validate inputs
if [ -z "$AGENT_NAME" ]; then
  echo "❌ Error: Agent name required"
  echo "Usage: /bs:agent-run <agent-name> \"<task>\" [flags]"
  exit 1
fi

if [ -z "$TASK" ] && [ "$RESUME" = false ]; then
  echo "❌ Error: Task required (unless --resume)"
  exit 1
fi

# Check if agent exists
AGENT_DIR="agents/$AGENT_NAME"
if [ ! -d "$AGENT_DIR" ]; then
  echo "❌ Agent not found: $AGENT_NAME"
  echo ""
  echo "Available agents:"
  ls agents/ 2>/dev/null || echo "  No custom agents found"
  echo ""
  echo "Create new agent: /bs:agent-new $AGENT_NAME"
  exit 1
fi

# Display execution plan
echo "🤖 Running agent: $AGENT_NAME"
echo "   Task: $TASK"
[ -n "$SESSION_ID" ] && echo "   Session: $SESSION_ID"
echo "   Model: $MODEL"
[ "$RESUME" = true ] && echo "   Mode: Resume session"
[ "$USE_LEARNINGS" = true ] && echo "   Learnings: enabled${LEARNING_KEYWORDS:+ (keywords: $LEARNING_KEYWORDS)}"
echo ""

# Load learnings context if requested (CS-073)
LEARNINGS_CONTEXT=""
if [ "$USE_LEARNINGS" = true ]; then
  echo "📚 Loading relevant learnings..."
  SCRIPTS_DIR="${HOME}/Projects/claude-setup/scripts"
  if [ -f "$SCRIPTS_DIR/extract-learnings.sh" ]; then
    LEARNINGS_CONTEXT=$("$SCRIPTS_DIR/extract-learnings.sh" format "" "$LEARNING_KEYWORDS" 2>/dev/null || true)
    if [ -n "$LEARNINGS_CONTEXT" ]; then
      echo "   Found relevant learnings to inject"
    else
      echo "   No relevant learnings found"
    fi
  else
    echo "   Warning: extract-learnings.sh not found"
  fi
fi

if [ "$DRY_RUN" = true ]; then
  echo "🏃 Dry run - would execute but not running"
  [ -n "$LEARNINGS_CONTEXT" ] && echo "" && echo "Learnings to inject:" && echo "$LEARNINGS_CONTEXT"
  exit 0
fi

# Let Claude execute the agent
echo "Claude will now:"
echo "1. Load agent configuration from $AGENT_DIR"
[ "$USE_LEARNINGS" = true ] && echo "2. Inject learnings context into prompt"
echo "${USE_LEARNINGS:+3}${USE_LEARNINGS:-2}. ${RESUME:+Resume session or }Execute task with agent's tools and prompts"
echo "${USE_LEARNINGS:+4}${USE_LEARNINGS:-3}. Return structured output${OUTPUT_FILE:+ to $OUTPUT_FILE}"
echo ""
echo "Executing..."
```

**Agent Prompt Injection (CS-073):**

When `--use-learnings` is enabled, the agent receives additional context at the start of its prompt:

```markdown
## Relevant Learnings

### From Previous Items

From CS-055 (cost-tracking):

- Bash 3.2 compatibility - use case statements instead of associative arrays
- jq for JSON manipulation - safe with --arg flag

From CS-079 (agent-validation):

- Expected sections and minimum content length catch silent failures

### From CLAUDE.md Patterns

### Safe Parsing (JSON, CSV, URL params, localStorage)

[relevant pattern content...]

### Two-Layer Async Error Handling

[relevant pattern content...]
```

This context helps the agent avoid re-learning known patterns and reference previous solutions.

## Agent Execution Flow

```
1. Load Agent Config
   ├─ Read agent.ts
   ├─ Read config.json
   ├─ Read prompts/system.md
   └─ Load tools and schemas

2. Session Management
   ├─ If --session: Load or create session
   ├─ If --resume: Restore previous context
   └─ Track state for future resume

3. Execute Task
   ├─ Send task to agent
   ├─ Agent uses tools autonomously
   ├─ Stream progress if --verbose
   └─ Collect results

4. Output Results
   ├─ Structured output (JSON schema)
   ├─ Save to file if --output
   ├─ Display summary
   └─ Save session if --session
```

## Session Support

### Create Session

```bash
# First run - creates session
/bs:agent-run api-tester "Test auth endpoints" --session auth-tests

# Saves to: data/sessions/auth-tests/
#   - agent-context.json
#   - results.json
```

### Resume Session

```bash
# Continue from where it left off
/bs:agent-run api-tester --session auth-tests --resume

# Or add new task to existing session
/bs:agent-run api-tester "Now test payment endpoints" --session auth-tests
```

### Session Context Structure

```json
{
  "sessionId": "auth-tests",
  "agentName": "api-tester",
  "created": "2026-01-16T10:00:00Z",
  "lastRun": "2026-01-16T14:30:00Z",
  "messages": [
    {
      "role": "user",
      "content": "Test auth endpoints",
      "timestamp": "2026-01-16T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "Testing /api/auth/login...",
      "timestamp": "2026-01-16T10:01:00Z"
    }
  ],
  "results": [
    {
      "endpoint": "/api/auth/login",
      "status": "passed",
      "tests": 5,
      "coverage": "100%"
    }
  ],
  "nextSteps": ["Test password reset flow", "Test OAuth integration"]
}
```

## Structured Output

### Define Schema

`agents/security-scanner/schemas/report.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "vulnerabilities": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "severity": { "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          "type": { "type": "string" },
          "file": { "type": "string" },
          "line": { "type": "number" },
          "description": { "type": "string" },
          "fix": { "type": "string" },
          "cve": { "type": "string" }
        },
        "required": ["severity", "type", "file", "description"]
      }
    },
    "summary": {
      "type": "object",
      "properties": {
        "total": { "type": "number" },
        "critical": { "type": "number" },
        "high": { "type": "number" },
        "medium": { "type": "number" },
        "low": { "type": "number" }
      }
    }
  },
  "required": ["vulnerabilities", "summary"]
}
```

### Use Structured Output

```bash
# Returns JSON matching schema
/bs:agent-run security-scanner "Scan project" --output security-report.json

# Output: security-report.json
{
  "vulnerabilities": [
    {
      "severity": "HIGH",
      "type": "SQL Injection",
      "file": "src/db/users.ts",
      "line": 42,
      "description": "Direct string interpolation in SQL query",
      "fix": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = ?', [userId])",
      "cve": "CWE-89"
    }
  ],
  "summary": {
    "total": 1,
    "critical": 0,
    "high": 1,
    "medium": 0,
    "low": 0
  }
}
```

## Model Selection

```bash
# Use Haiku for simple tasks (faster, cheaper)
/bs:agent-run doc-writer "Add JSDoc comments" --model haiku

# Use Sonnet for balanced tasks (default)
/bs:agent-run security-scanner "Full audit" --model sonnet

# Use Opus for complex reasoning
/bs:agent-run architect "Design microservices architecture" --model opus
```

**Cost optimization:**

- Haiku: 5x cheaper, good for simple tasks
- Sonnet: Balanced, use as default
- Opus: 5x more expensive, complex reasoning only

## Examples

### Security Scanning

```bash
/bs:agent-run security-scanner "Scan authentication module" \
  --output reports/security-$(date +%Y%m%d).json \
  --verbose
```

### API Testing

```bash
# Start testing session
/bs:agent-run api-tester "Test all auth endpoints" --session auth-tests

# Later, continue testing
/bs:agent-run api-tester "Test payment endpoints" --session auth-tests

# Review session results
cat data/sessions/auth-tests/results.json
```

### Documentation Generation

```bash
/bs:agent-run doc-writer "Generate API documentation for src/api/" \
  --output docs/api.md \
  --model sonnet
```

### Performance Audit

```bash
/bs:agent-run performance-auditor "Audit bundle size and Core Web Vitals" \
  --output reports/performance.json
```

### Refactoring

```bash
/bs:agent-run refactoring-specialist "Refactor src/utils/ to remove duplication" \
  --session refactor-utils \
  --verbose
```

## Integration with Workflow

### During Development

```bash
/bs:dev feature-payment

# Mid-feature: Run security scan
/bs:agent-run security-scanner "Scan payment integration"

# Fix issues found
# ...

# Continue development
/bs:quality --merge
```

### Continuous Quality

```bash
# After each commit
/bs:agent-run code-reviewer "Review changes in current branch"

# Weekly security audit
/bs:agent-run security-scanner "Full project scan" --output weekly-security.json

# Monthly performance check
/bs:agent-run performance-auditor "Full performance audit"
```

### Parallel Agent Execution

```bash
# Run multiple agents concurrently
/bs:agent-run security-scanner "Scan project" &
/bs:agent-run performance-auditor "Audit performance" &
/bs:agent-run doc-writer "Update API docs" &

wait
echo "All agents complete"
```

## Hooks for Auditing

### PreToolUse Hook

```typescript
// agents/security-scanner/hooks/preToolUse.ts
export function preToolUse(tool: string, args: any) {
  // Block dangerous operations
  if (tool === 'Bash' && args.command.includes('rm -rf')) {
    throw new Error('Dangerous command blocked')
  }

  // Log tool usage
  console.log(`[AUDIT] Using tool: ${tool}`)

  return true // Allow execution
}
```

### PostToolUse Hook

```typescript
// agents/security-scanner/hooks/postToolUse.ts
export function postToolUse(tool: string, result: any) {
  // Collect metrics
  metrics.increment(`agent.tool.${tool}`)

  // Save audit log
  auditLog.write({
    tool,
    timestamp: new Date(),
    result: result.success,
  })
}
```

## See Also

- `/bs:agent-new` - Create custom agents
- `/bs:session` - Manage sessions
- Task tool - Run built-in specialized agents
- [Claude Agent SDK Guide](https://nader.substack.com/p/the-complete-guide-to-building-agents)
