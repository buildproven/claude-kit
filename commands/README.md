---
name: README
description: Command toolkit reference
tags: [help, reference, overview]
category: meta
model: haiku
---

# Commands: Professional Development Toolkit

**Grade A Claude Code configuration with 35+ production-ready commands.**

Commands use prefixes: `/bs:` (build & ship), `/gh:` (GitHub), `/cc:` (Claude Code), or no prefix (utilities).

> To rename the `bs:` prefix, see the README or run `./scripts/rename-prefix.sh YOUR_PREFIX`

---

## Command Categories

### Development & Quality (9)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/bs:new` | Create new project (quality-only) | Starting greenfield project, framework-agnostic |
| `/bs:dev` | Smart feature development | Starting new features with complexity assessment |
| `/bs:quality` | 95% ship-ready quality loop | Before creating PR (autonomous review/fix cycle) |
| `/bs:quality --level 98` | 98% production-perfect loop | Critical releases requiring security/a11y/perf |
| `/bs:hotfix` | Emergency production fixes | Production emergencies (5-10 min) |
| `/bs:verify` | Post-deploy verification | Smoke tests with auto-rollback |
| `/bs:deps` | Dependency health management | Check outdated packages, security audit |
| `/bs:test` | Smart test runner | Auto-detects Jest/Vitest/Playwright |
| `/bs:workflow` | Daily workflow reference | Quick command lookup |

### Agent & Session (5)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/bs:session` | Manage agent sessions | Multi-day workflows (save/load/list) |
| `/bs:session --quick` | Quick context save/restore | Short breaks (auto-overwrites) |
| `/bs:resume` | Resume last session | Auto-detect and continue work |
| `/bs:agent-new` | Create specialized agents | Custom agent with Claude Agent SDK |
| `/bs:agent-run` | Run custom agents | With session support |

### DevOps & Automation (5)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/bs:git-sync` | Full git workflow | Commit + push + pull + docs + deploy + release |
| `/bs:ralph-dev` | Autonomous backlog loop | Multi-item execution with learning capture |
| `/bs:ralph-next` | Graph backlog loop | Reflect/decide routing + trajectory evidence |
| `/bs:cleanup` | AI CLI cache cleanup | High memory/disk usage from Claude/Cursor/Codex |
| `/bs:sync-ai` | Sync to other AI CLIs | Share commands with Codex/Gemini |

### Strategy & Planning (2)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/bs:strategy` | Multi-LLM synthesis & advisory panel | Strategic decisions, debate mode |
| `/bs:backlog` | Project backlog management | Value-based prioritization |

### Configuration & Maintenance (3)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/bs:sync` | Config health checks | Verify/repair Claude Code symlinks |
| `/bs:help` | Command reference | Quick lookup of all commands |
| `/bs:maintain` | Self-maintaining setup | Quarterly audits, auto-fixes |

### Root Commands (Utilities) (4)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/debug` | Systematic debugging | When stuck on a thorny bug (Rule of Three) |
| `/refactor` | Code quality cleanup | jscpd (duplicates) + knip (dead code) + simplification |
| `/update-claudemd` | Update CLAUDE.md | Capture learnings from session |
| `/open-source-prep` | Prepare for open source | Remove secrets, ensure quality |

---

## Typical Workflows

### New Feature Development

```bash
# 1. Start with complexity assessment
/bs:dev user-authentication

# 2. TDD development
/bs:test --watch

# 3. Ship it
/bs:quality --merge     # Creates PR automatically
```

### Weekly Maintenance

```bash
/bs:git-sync --all    # Sync all repos
/bs:maintain          # Health check
/bs:cleanup           # Clean AI CLI caches
```

### Production Release

```bash
/bs:quality --level 98 --merge   # 98% quality + security + a11y + perf
```

---

## Global Availability

All commands work in:
- Claude Code CLI (any directory)
- Claude Code Web UI (any repo)

**Setup**: Commands are symlinked from `claude-setup/commands/` to `~/.claude/commands/`
