---
model: opus
name: bs:agent-new
description: Create new specialized agent with Claude Agent SDK
argument-hint: '<agent-name> [--type code-review|testing|security|custom]'
tags: [agents, sdk, development]
category: agents
---

model: opus

# /bs:agent-new - Create Specialized Agent

**Usage**: `/bs:agent-new <agent-name> [--type <type>]`

Create a new specialized agent using Claude Agent SDK patterns.

## Quick Start

```bash
/bs:agent-new security-scanner
/bs:agent-new api-tester --type testing
/bs:agent-new doc-writer --type documentation
```

## Agent Types

```bash
--type code-review      # Code quality and review
--type testing          # Test generation and execution
--type refactoring      # Code restructuring
--type documentation    # Doc generation and updates
--type security         # Security scanning and fixes
--type performance      # Performance optimization
--type exploration      # Codebase understanding
--type custom           # Build from scratch (default)
```

## What Gets Created

```
agents/{agent-name}/
├── agent.ts              # Main agent implementation
├── config.json           # Agent configuration
├── tools/                # Custom tools (optional)
│   └── {tool-name}.ts
├── prompts/              # System prompts
│   └── system.md
└── README.md             # Agent documentation
```

## Agent Template Structure

### agent.ts

```typescript
import { Agent, AgentSDK } from '@anthropic/agent-sdk'

export class SecurityScannerAgent extends Agent {
  name = 'security-scanner'
  description = 'Scans code for security vulnerabilities'

  constructor(sdk: AgentSDK) {
    super(sdk)
  }

  async run(task: string): Promise<string> {
    // Agent implementation
    const result = await this.query({
      messages: [
        {
          role: 'user',
          content: task,
        },
      ],
      tools: this.tools,
      systemPrompt: this.systemPrompt,
    })

    return result
  }

  get tools() {
    return ['Read', 'Grep', 'Glob', 'Bash']
  }

  get systemPrompt() {
    return `You are a security scanning agent specializing in finding vulnerabilities.

    Focus on:
    - SQL injection risks
    - XSS vulnerabilities
    - Authentication issues
    - Secrets exposure
    - Dependency vulnerabilities

    Provide actionable fixes with code examples.`
  }
}
```

### config.json

```json
{
  "name": "security-scanner",
  "version": "1.0.0",
  "description": "Security vulnerability scanner",
  "model": "sonnet",
  "permissions": {
    "acceptEdits": false,
    "allowedTools": ["Read", "Grep", "Glob", "Bash"],
    "dangerousOperations": false
  },
  "hooks": {
    "preToolUse": [],
    "postToolUse": ["auditLog"]
  },
  "structuredOutput": {
    "enabled": true,
    "schema": "schemas/security-report.json"
  }
}
```

## Implementation

```bash
#!/bin/bash

AGENT_NAME="$1"
AGENT_TYPE="${2:-custom}"

if [ -z "$AGENT_NAME" ]; then
  echo "❌ Error: Agent name required"
  echo "Usage: /bs:agent-new <name> [--type <type>]"
  exit 1
fi

# Parse type flag
if [[ "$2" == "--type" ]]; then
  AGENT_TYPE="$3"
fi

AGENT_DIR="agents/$AGENT_NAME"

echo "🤖 Creating agent: $AGENT_NAME"
echo "   Type: $AGENT_TYPE"
echo ""

if [ -d "$AGENT_DIR" ]; then
  echo "❌ Agent already exists: $AGENT_DIR"
  exit 1
fi

# Create directory structure
mkdir -p "$AGENT_DIR/tools"
mkdir -p "$AGENT_DIR/prompts"
mkdir -p "$AGENT_DIR/schemas"

echo "📁 Created directory: $AGENT_DIR"
echo ""
echo "Claude will now create agent files based on type: $AGENT_TYPE"
echo ""
echo "Files to create:"
echo "  - $AGENT_DIR/agent.ts"
echo "  - $AGENT_DIR/config.json"
echo "  - $AGENT_DIR/prompts/system.md"
echo "  - $AGENT_DIR/README.md"
echo "  - $AGENT_DIR/schemas/output.json (if structured output)"
```

## Agent SDK Integration

```typescript
import { SecurityScannerAgent } from './agents/security-scanner/agent'
const agent = new SecurityScannerAgent(sdk)
const report = await agent.run('Scan the authentication module')
```

```bash
/bs:agent-run security-scanner "Scan authentication"
```

## Best Practices

1. **Permissions:** `acceptEdits: false` for review agents, `acceptEdits: true` for refactoring agents. Use `canUseTool` for fine-grained control.
2. **Structured Output:** Define JSON schemas for programmatic results, enables downstream automation.
3. **Subagents:** Delegate specialized tasks, use haiku for simple tasks, parallel execution where possible.
4. **Hooks:** PreToolUse for validation/blocking; PostToolUse for audit logging.
5. **Sessions:** Resume conversations with session IDs for multi-turn interactions.

## Examples

```bash
/bs:agent-new security-scanner --type security
/bs:agent-new api-tester --type testing
/bs:agent-new doc-writer --type documentation
```
