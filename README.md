# Claude Power Kit

Professional Claude Code configuration. 35+ commands, 15+ skills, 18 agent prompts, ESLint plugin. Grade A setup. 2-minute install.

Extracted from a production Claude Code setup used daily for SaaS development.

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USER/claude-power-kit.git ~/Projects/claude-setup
~/Projects/claude-setup/install.sh

# Restart Claude Code - done!
```

## What's Included

### Core Configuration

- **settings.json** - 280+ permission rules, Opus model, extended thinking
- **CLAUDE.md** - Global development preferences (customize to your style)
- **Symlink-based** - Edit in claude-setup, changes apply everywhere

### Commands (35+)

**Development & Quality (9)**
| Command | Purpose |
|---------|---------|
| `/bs:new` | Create new project with quality infrastructure |
| `/bs:dev` | Smart feature development with complexity assessment |
| `/bs:quality` | Autonomous quality loop (95% or 98%) |
| `/bs:hotfix` | Emergency production fixes (5-10 min) |
| `/bs:verify` | Post-deploy verification with auto-rollback |
| `/bs:deps` | Dependency health management |
| `/bs:test` | Auto-detect test framework and run tests |
| `/bs:workflow` | Daily workflow quick reference |
| `/bs:sota` | Score your Claude Code setup against benchmarks |

**Agent & Session (4)**
| Command | Purpose |
|---------|---------|
| `/bs:session` | Manage agent sessions (includes `--quick` for fast save/restore) |
| `/bs:resume` | Resume last session or checkpoint |
| `/bs:agent-new` | Create specialized agents |
| `/bs:agent-run` | Run custom agents with session support |

**DevOps & Automation (6)**
| Command | Purpose |
|---------|---------|
| `/bs:git-sync` | Auto-sync repos, create releases, deploy |
| `/bs:ralph-dev` | Autonomous backlog iteration with learning loops |
| `/bs:ralph-next` | Graph-orchestrated backlog execution |
| `/bs:cleanup` | Clean AI CLI caches and temp files |
| `/bs:sync-ai` | Sync prompts to Codex/Gemini |
| `/bs:collab` | Multi-model collaboration orchestrator |

**Strategy & Planning (3)**
| Command | Purpose |
|---------|---------|
| `/bs:strategy` | Multi-LLM strategy synthesis (debate mode) |
| `/bs:backlog` | Project backlog with value-based prioritization |
| `/bs:read` | Read articles and extract actionable insights |

**Observability (4)**
| Command | Purpose |
|---------|---------|
| `/bs:dashboard` | Unified health overview |
| `/bs:status` | Project catch-up after time away |
| `/bs:cost` | Cost tracking per feature/branch |
| `/bs:context` | Context recovery and checkpoint restore |

**Configuration (4)**
| Command | Purpose |
|---------|---------|
| `/bs:sync` | Claude config health checks |
| `/bs:help` | Command reference and usage guide |
| `/bs:maintain` | Self-maintaining setup: audits, auto-fixes |
| `/bs:onboard` | Interactive onboarding for new users |

**Content (1)**
| Command | Purpose |
|---------|---------|
| `/bs:image` | Generate images for newsletters/social/carousels |

**Root Commands (4)**
| Command | Purpose |
|---------|---------|
| `/debug` | Systematic debugging protocol |
| `/refactor` | Code quality cleanup (jscpd + knip) |
| `/update-claudemd` | Update CLAUDE.md with learnings |
| `/open-source-prep` | Prepare project for open source |

**GitHub (2)**
| Command | Purpose |
|---------|---------|
| `/gh:review-pr` | Autonomous PR review workflow |
| `/gh:fix-issue` | GitHub issue resolution workflow |

**Claude Code (2)**
| Command | Purpose |
|---------|---------|
| `/cc:optimize` | Cost optimization and efficiency guide |
| `/cc:create-command` | Create new Claude Code commands |

### Skills (15+)

- **error-handling** - Auto-invoke: consistent error handling patterns
- **api-conventions** - Auto-invoke: consistent API design
- **test-strategy** - Auto-invoke: test coverage guidance
- **frontend-design** - Production-grade frontend interfaces
- **webapp-testing** - Playwright browser automation
- **ui-reviewer** - UI/UX design review and feedback
- **doc-coauthoring** - Structured documentation workflow
- **mcp-builder** - MCP server creation guide
- **skill-creator** - Create new skills
- **recover** - Crash recovery and state restoration
- **cleanup** - System resource cleanup
- **pdf / docx / xlsx** - Document creation and manipulation
- **seo** - SEO keyword research and analysis

### Agents (18)

Pre-built agent prompts for specialized tasks:
- **code-reviewer** - Code quality, security, best practices
- **security-auditor** - OWASP, secrets, dependency vulnerabilities
- **architect-reviewer** - System design and architectural patterns
- **performance-engineer** - Lighthouse, bundle analysis, Core Web Vitals
- **prompt-engineer** - AI prompt optimization and token reduction
- **business-panel-experts** - Multi-expert strategy synthesis
- **competitive-analyst** - Market positioning and feature comparison
- **refactoring-specialist** - Safe code transformation
- **postgres-pro** - Query optimization, schema design
- **accessibility-tester** - WCAG 2.1 AA compliance
- And more in `agents/`

### ESLint Plugin (`eslint-plugin-defensive`)

Custom rules that catch issues standard linters miss:
- `no-unsafe-json-parse` - Unsafe JSON handling
- `no-empty-catch` - Meaningless error handling
- `require-auth-middleware` - Missing API auth guards
- `require-useCallback` - Inline handlers causing perf issues
- `require-guard-clause` - Division by zero without guards

---

## Customizing the Command Prefix

Commands use the `bs:` prefix by default (short for "build & ship"). You can rename this to anything you want.

### Quick Rename (Recommended)

Run the included rename script:

```bash
# Rename bs: to your preferred prefix (e.g., "my:", "dev:", "x:")
./scripts/rename-prefix.sh my

# This renames:
#   commands/bs/ -> commands/my/
#   All "bs:" references in command files -> "my:"
#   README and help references
```

### Manual Rename

1. **Rename the directory:**
   ```bash
   mv commands/bs commands/YOUR_PREFIX
   ```

2. **Update references in command files:**
   ```bash
   # macOS
   find commands/YOUR_PREFIX -name "*.md" -exec sed -i '' 's|/bs:|/YOUR_PREFIX:|g' {} +

   # Linux
   find commands/YOUR_PREFIX -name "*.md" -exec sed -i 's|/bs:|/YOUR_PREFIX:|g' {} +
   ```

3. **Update the frontmatter `name:` field in each command:**
   ```bash
   find commands/YOUR_PREFIX -name "*.md" -exec sed -i '' 's|name: bs:|name: YOUR_PREFIX:|g' {} +
   ```

4. **Re-run the sync script to update symlinks:**
   ```bash
   ./scripts/setup-claude-sync.sh
   ```

### Prefix Conventions

| Prefix | Style | Example |
|--------|-------|---------|
| `bs:` | Default (build & ship) | `/bs:dev`, `/bs:quality` |
| `my:` | Personal | `/my:dev`, `/my:quality` |
| `dev:` | Developer-focused | `/dev:new`, `/dev:quality` |
| `x:` | Minimal | `/x:dev`, `/x:quality` |
| `go:` | Action-oriented | `/go:dev`, `/go:quality` |

---

## Configuration Management

**Single Source of Truth**: Always edit files in `claude-setup/`, not `~/.claude/`

```
claude-setup/
  config/settings.json  ->  ~/.claude/settings.json
  config/CLAUDE.md      ->  ~/.claude/CLAUDE.md
  commands/             ->  ~/.claude/commands/
  scripts/              ->  ~/.claude/scripts/
  agents/               ->  ~/.claude/agents/
```

### Health Check

```bash
./scripts/setup-claude-sync.sh --check
```

### Repair Symlinks

```bash
./scripts/setup-claude-sync.sh --repair
```

---

## Key Settings

| Setting | Value |
|---------|-------|
| Model | claude-opus-4-6 |
| Extended Thinking | Enabled |
| Auto-Approve Edits | Enabled |
| Permission Rules | 280+ allow, 8 deny |

---

## What's NOT Included

This kit is the generic, reusable core. The following were removed during extraction:
- API keys, credentials, and .env files (use `.env.template`)
- Business-specific commands (newsletter posting, product writing)
- Brand-specific content and voice profiles
- Internal backlog and strategy documents
- Service-specific integrations (private business tooling)

---

## License

MIT - Use, modify, and distribute freely.

See [CHANGELOG.md](CHANGELOG.md) for version history.
