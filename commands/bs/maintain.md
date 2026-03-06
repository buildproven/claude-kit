---
name: bs:maintain
description: 'Self-maintaining setup: health checks, optimization, auto-fixes'
argument-hint: '[--audit|--fix|--optimize]'
category: maintenance
model: sonnet
---

# /bs:maintain - Setup Maintenance Agent

**Purpose**: Self-healing, self-improving Claude Code setup

## Usage

```bash
/bs:maintain              # Default: Health check
/bs:maintain --audit      # Deep analysis and recommendations
/bs:maintain --fix        # Auto-repair issues (with approval)
/bs:maintain --optimize   # Continuous improvement suggestions
```

---

## Mode 1: Health Check (Default)

**Quick verification of setup integrity**

### 1. Symlink Verification

```bash
# Check all symlinks from ~/.claude/ to source repo
SETUP_REPO="$HOME/Projects/claude-setup"

# Verify commands symlink
if [ ! -L ~/.claude/commands ]; then
  echo "❌ Commands symlink broken"
else
  TARGET=$(readlink ~/.claude/commands)
  if [ "$TARGET" != "$SETUP_REPO/commands" ]; then
    echo "⚠️  Commands symlink points to wrong location: $TARGET"
  else
    echo "✅ Commands symlink: OK"
  fi
fi

# Verify skills symlink
if [ ! -L ~/.claude/skills ]; then
  echo "❌ Skills symlink broken"
else
  TARGET=$(readlink ~/.claude/skills)
  if [ "$TARGET" != "$SETUP_REPO/skills" ]; then
    echo "⚠️  Skills symlink points to wrong location: $TARGET"
  else
    echo "✅ Skills symlink: OK"
  fi
fi

# Verify settings symlink
if [ ! -L ~/.claude/settings.json ]; then
  echo "❌ Settings symlink broken"
else
  TARGET=$(readlink ~/.claude/settings.json)
  if [ "$TARGET" != "$SETUP_REPO/config/settings.json" ]; then
    echo "⚠️  Settings symlink points to wrong location: $TARGET"
  else
    echo "✅ Settings symlink: OK"
  fi
fi

# Verify CLAUDE.md symlink
if [ ! -L ~/.claude/CLAUDE.md ]; then
  echo "❌ CLAUDE.md symlink broken"
else
  TARGET=$(readlink ~/.claude/CLAUDE.md)
  if [ "$TARGET" != "$SETUP_REPO/config/CLAUDE.md" ]; then
    echo "⚠️  CLAUDE.md symlink points to wrong location: $TARGET"
  else
    echo "✅ CLAUDE.md symlink: OK"
  fi
fi
```

### 2. MCP Server Status

```bash
# Run MCP health check script (CS-108)
SETUP_REPO="$HOME/Projects/claude-setup"
if [ -f "$SETUP_REPO/scripts/check-mcp-health.sh" ]; then
  bash "$SETUP_REPO/scripts/check-mcp-health.sh"
else
  # Fallback: just list configured servers
  claude mcp list
fi
```

### 3. API Key Validation (ACFS-style)

```bash
# Verify critical API keys are set and valid
KEYS_TO_CHECK=(
  "ANTHROPIC_API_KEY"
  "OPENAI_API_KEY"
  "PERPLEXITY_API_KEY"
  "STRIPE_SECRET_KEY"
)

for KEY in "${KEYS_TO_CHECK[@]}"; do
  if [ -z "${!KEY}" ]; then
    echo "⚠️  $KEY not set"
  else
    # Mask key for display (show first 8 chars)
    MASKED="${!KEY:0:8}..."
    echo "✅ $KEY: $MASKED"
  fi
done

# Test Anthropic API (quick ping)
if [ -n "$ANTHROPIC_API_KEY" ]; then
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    https://api.anthropic.com/v1/messages \
    -d '{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' \
    2>/dev/null)
  if [ "$RESPONSE" = "200" ]; then
    echo "✅ Anthropic API: Connected"
  else
    echo "⚠️  Anthropic API: HTTP $RESPONSE"
  fi
fi
```

### 4. Multi-Agent Environment (ACFS-style)

```bash
# Check if multiple AI CLIs are configured
echo "Multi-Agent Environment:"

# Claude Code
if command -v claude &> /dev/null; then
  echo "✅ Claude Code: $(claude --version 2>/dev/null | head -1)"
else
  echo "⚠️  Claude Code: Not installed"
fi

# OpenAI Codex CLI (if using)
if command -v codex &> /dev/null; then
  echo "✅ Codex CLI: Available"
else
  echo "ℹ️  Codex CLI: Not installed (optional)"
fi

# Gemini CLI (if using)
if command -v gemini &> /dev/null; then
  echo "✅ Gemini CLI: Available"
else
  echo "ℹ️  Gemini CLI: Not installed (optional)"
fi

# Check shared .env file
ENV_FILE="$HOME/Projects/claude-setup/.env"
if [ -f "$ENV_FILE" ]; then
  KEY_COUNT=$(grep -c "=" "$ENV_FILE" 2>/dev/null || echo "0")
  echo "✅ Shared .env: $KEY_COUNT keys configured"
else
  echo "⚠️  Shared .env: Not found at $ENV_FILE"
fi
```

### 5. Command Validation

```bash
# Find all commands
COMMANDS=$(find $SETUP_REPO/commands -name "*.md" -type f)

# For each command, verify:
# - Has valid frontmatter (description field)
# - No syntax errors in code blocks
# - No broken references to deleted files

for CMD in $COMMANDS; do
  # Check frontmatter
  if ! grep -q "^---$" "$CMD"; then
    echo "⚠️  Missing frontmatter: $CMD"
  elif ! grep -q "^description:" "$CMD"; then
    echo "⚠️  Missing description: $CMD"
  fi

  # Check for references to deleted VBL commands
  if grep -q "pnpm vbl" "$CMD"; then
    echo "⚠️  VBL CLI reference found: $CMD"
  fi
done
```

### 6. Settings Validation

```bash
# Read settings.json
# Verify all enabled plugins exist
# Check for permission conflicts (deny overriding allow)
# Validate JSON syntax
```

**Report:**

```
╔══════════════════════════════════════════════════════╗
║  HEALTH CHECK SUMMARY                                ║
╠══════════════════════════════════════════════════════╣
║  Symlinks:      ✅ 4/4 OK                            ║
║  MCP Servers:   ✅ 8/8 Connected                     ║
║  API Keys:      ✅ 4/4 Valid                         ║
║  Multi-Agent:   ✅ Claude + Codex + Gemini           ║
║  Commands:      ⚠️  28/29 Valid (1 issue)            ║
║  Settings:      ✅ Valid                             ║
╚══════════════════════════════════════════════════════╝

Issues Found:
- commands/bs/strategy.md: Contains VBL CLI reference
```

---

## Mode 2: Deep Audit (--audit)

**Comprehensive analysis with recommendations**

### 1. Redundancy Detection

Use sequential thinking to analyze all commands:

```markdown
Use sequential thinking to detect redundancy:

**All Commands:** [List of 15 remaining commands]

**Analyze step by step:**

1. **Functional Overlap Analysis**
   - Which commands do similar things?
   - Where is there duplicate functionality?
   - Are there commands that could be merged?

2. **Usage Pattern Analysis**
   - Which commands are frequently used together?
   - Which commands haven't been used in 60+ days?
   - Are there orphaned commands?

3. **Complexity Assessment**
   - Which commands are unnecessarily complex?
   - Are there commands doing too many things?
   - Should any commands be split?

4. **Dependency Mapping**
   - Which commands depend on others?
   - Are there circular dependencies?
   - What's the command call graph?

5. **Recommendations**
   - Commands to merge: [List with rationale]
   - Commands to archive: [List with rationale]
   - Commands to split: [List with rationale]
   - Commands to simplify: [List with rationale]
```

### 2. Business Logic Leak Detection

Scan for VBL-specific or business-specific content:

```bash
# Patterns that indicate business logic:
PATTERNS=(
  "vibebuildlab"
  "vbl"
  "pnpm vbl"
  "/Users/youruser"
  "~/Projects/vibebuildlab"
  "\$25"
  "revenue"
  "pricing"
)

for PATTERN in "${PATTERNS[@]}"; do
  MATCHES=$(grep -ril "$PATTERN" $SETUP_REPO/commands --include="*.md" 2>/dev/null)
  if [ -n "$MATCHES" ]; then
    echo "⚠️  Business reference found: $PATTERN"
    echo "$MATCHES"
  fi
done
```

### 3. Hardcoded Path Detection

```bash
# Find hardcoded absolute paths
grep -rn "^[^#]*~/Projects/" $SETUP_REPO/commands --include="*.md" 2>/dev/null
grep -rn "^[^#]*/Users/youruser" $SETUP_REPO/commands --include="*.md" 2>/dev/null

# Should use environment variables instead:
# - $USER_PROJECTS_DIR for ~/Projects
# - $HOME for ~
# - Relative paths where possible
```

### 4. Best Practices Validation

Check each command against best practices:

- **Frontmatter**: Has description, argument-hint
- **Documentation**: Clear usage examples
- **Error handling**: Graceful failure modes
- **Permissions**: No unnecessary sudo or destructive commands
- **Portability**: Works on macOS and Linux
- **Environment**: Uses env vars instead of hardcoded paths

### 5. Improvement Suggestions

```markdown
## Audit Report

### Recommendations (Priority Ordered)

**HIGH PRIORITY:**

1. Merge /bs:ready and /bs:perfect (98% duplicate logic)
2. Archive /bs:cleanup (unused for 90 days)
3. Remove hardcoded path in /bs:git-sync line 42

**MEDIUM PRIORITY:** 4. Add error handling to /bs:post for MCP failures 5. Update /bs:strategy to handle missing API keys gracefully

**LOW PRIORITY:** 6. Add examples to /cc:optimize 7. Consider splitting /bs:dev (complexity = 8/10)
```

---

## Mode 3: Auto-Fix (--fix)

**Automated repairs with user approval**

### 1. Fix Broken Symlinks

```bash
# Detect broken symlinks
if [ ! -L ~/.claude/commands ] || [ ! -e ~/.claude/commands ]; then
  echo "🔧 Fixing commands symlink..."
  rm -f ~/.claude/commands
  ln -s $SETUP_REPO/commands ~/.claude/commands
  echo "✅ Fixed"
fi

# Repeat for skills, settings.json, CLAUDE.md
```

### 2. Update Command Frontmatter

```bash
# For commands missing descriptions, generate from content
for CMD in $(find $SETUP_REPO/commands -name "*.md"); do
  if ! grep -q "^description:" "$CMD"; then
    # Generate description from first H1 or paragraph
    DESC=$(grep -m1 "^# " "$CMD" | sed 's/^# //')

    echo "📝 Adding description to $(basename $CMD): $DESC"
    # Insert frontmatter (ask user approval)
  fi
done
```

### 3. Remove VBL References

Ask user if they want to:

- Remove VBL CLI calls
- Replace with environment variable checks
- Move commands to vibebuildlab repo

### 4. Fix Permissions

```bash
# Ensure permissions in settings.json are clean
# - No conflicts between allow/deny
# - Use wildcards efficiently (mcp__* instead of listing each)
# - Remove deprecated permissions
```

---

## Mode 4: Optimize (--optimize)

**Continuous improvement automation**

### 1. Command Merging

Identify commands that can be merged:

**Example:**

```
/bs:ready and /bs:perfect have 95% identical logic.
Suggestion: Merge into single /bs:quality with --level flag:
  /bs:quality --level 95  (current ready)
  /bs:quality --level 98  (current perfect)
```

### 2. Archive Unused

```bash
# Track command usage (if logs available)
# Archive commands not used in 90 days
# Move to commands/_archive/ with date
```

### 3. Apply Latest Patterns

```bash
# Check for new Claude Code features
# Suggest updates to leverage new capabilities
# Example: New MCP servers, new tool permissions
```

### 4. Update Documentation

```bash
# Auto-update README.md with command count
# Sync command descriptions to main docs
# Generate command reference table
```

---

## Scheduling (Optional)

**Run weekly via cron or GitHub Actions:**

```yaml
# .github/workflows/maintain-setup.yml
name: Maintain Setup

on:
  schedule:
    - cron: '0 0 * * 0' # Every Sunday
  workflow_dispatch:

jobs:
  maintain:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Health Check
        run: |
          claude code /bs:maintain --audit
```

---

## Implementation Notes

- **Non-destructive**: All fixes require approval before applying
- **Idempotent**: Safe to run multiple times
- **Logged**: Creates `.audit/reports/maintain-YYYY-MM-DD.md` with findings
- **Smart**: Uses sequential thinking for complex analysis
- **Fast**: Health check runs in < 5 seconds

---

## Examples

```bash
# Quick health check
/bs:maintain

# Deep audit before major changes
/bs:maintain --audit

# Auto-repair after setup changes
/bs:maintain --fix

# Quarterly optimization review
/bs:maintain --optimize
```

---

**Run Mode:** Execute based on flag or default to health check.
