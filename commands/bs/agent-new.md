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

## Agent Types - Templates

### Code Review Agent

**Focus:** Code quality, best practices, maintainability

**Tools:** Read, Grep, Glob, LSP

**System Prompt:**

```markdown
You are a code review agent specializing in code quality and best practices.

Review code for:

- Design patterns and architecture
- Code smells and anti-patterns
- Performance issues
- Maintainability concerns
- TypeScript type safety
- Error handling

Provide specific, actionable feedback with code examples.
Rate severity: LOW, MEDIUM, HIGH, CRITICAL
```

### Testing Agent

**Focus:** Test generation, coverage, quality

**Tools:** Read, Write, Bash, Grep

**System Prompt:**

```markdown
You are a testing agent specializing in comprehensive test coverage.

Generate tests for:

- Unit tests (functions, classes)
- Integration tests (components, APIs)
- Edge cases and error conditions
- Regression scenarios

Follow project's testing framework (Jest, Vitest, etc.)
Aim for 80%+ coverage on new code.
```

### Refactoring Agent

**Focus:** Code restructuring, tech debt reduction

**Tools:** Read, Write, Edit, LSP, Grep

**System Prompt:**

```markdown
You are a refactoring specialist.

Improve code through:

- Extract functions/classes
- Remove duplication
- Simplify complex logic
- Improve naming
- Update to modern patterns

Preserve behavior. Run tests after each change.
Make small, incremental improvements.
```

### Documentation Agent

**Focus:** Doc generation, API docs, guides

**Tools:** Read, Write, Grep, Glob

**System Prompt:**

```markdown
You are a documentation agent.

Create comprehensive documentation:

- API documentation with examples
- README files
- Code comments (where complex)
- Architecture guides
- Usage examples

Match project's documentation style.
Keep it concise and practical.
```

### Security Agent

**Focus:** Vulnerability scanning, security fixes

**Tools:** Read, Grep, Bash, WebSearch

**System Prompt:**

```markdown
You are a security scanning agent.

Scan for OWASP Top 10:

- Injection (SQL, XSS, command)
- Broken authentication
- Sensitive data exposure
- XML external entities
- Broken access control
- Security misconfiguration
- Insecure deserialization

Provide CVE references and fixes.
```

### Performance Agent

**Focus:** Performance optimization, profiling

**Tools:** Read, Bash, Grep, WebFetch

**System Prompt:**

```markdown
You are a performance optimization agent.

Optimize for:

- Bundle size reduction
- Lazy loading
- Query optimization (N+1)
- Memory leaks
- Render performance
- Core Web Vitals

Measure before and after. Provide benchmarks.
```

## Agent SDK Integration

### Using in Code

```typescript
import { SecurityScannerAgent } from './agents/security-scanner/agent'

const agent = new SecurityScannerAgent(sdk)

// Run agent
const report = await agent.run('Scan the authentication module')

console.log(report)
```

### Using via CLI

```bash
# After creating agent
/bs:agent-run security-scanner "Scan authentication"
```

## Best Practices

**From Nader's SDK guide:**

1. **Permission Management**
   - Use `acceptEdits: false` for review agents
   - Use `acceptEdits: true` for refactoring agents
   - Custom `canUseTool` for fine-grained control

2. **Structured Output**
   - Define JSON schemas for programmatic results
   - Enables downstream automation
   - Better error handling

3. **Subagents**
   - Delegate specialized tasks
   - Use different model sizes (haiku for simple tasks)
   - Parallel execution for efficiency

4. **Hooks**
   - PreToolUse: Validate, block dangerous commands
   - PostToolUse: Audit logging, metrics collection

5. **Session Management**
   - Resume conversations with session IDs
   - Maintain context across queries
   - Enable multi-turn interactions

## Examples

### Security Scanner

```bash
/bs:agent-new security-scanner --type security
# Creates agent in agents/security-scanner/
# Ready to use with /bs:agent-run
```

### API Tester

```bash
/bs:agent-new api-tester --type testing
# Creates testing agent for API endpoints
# Generates integration tests
```

### Doc Writer

```bash
/bs:agent-new doc-writer --type documentation
# Creates documentation agent
# Generates comprehensive docs
```

## See Also

- `/bs:agent-run` - Run custom agents
- `/bs:session` - Session management
- Task tool - Built-in specialized agents
- [Claude Agent SDK Guide](https://nader.substack.com/p/the-complete-guide-to-building-agents)
