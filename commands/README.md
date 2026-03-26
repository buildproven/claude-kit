---
name: README
description: BS Commands — Professional development toolkit reference
tags: [help, reference, overview]
category: meta
model: haiku
---

# BS Commands: Professional Development Toolkit

**Grade A Claude Code configuration with 34 production-ready /bs commands.**

Commands use prefixes: `/bs:` (Brett Stark), `/gh:` (GitHub), `/cc:` (Claude Code), or no prefix (utilities).

---

## Command Categories

### Development & Quality (9)

| Command                  | Purpose                           | When to Use                                      |
| ------------------------ | --------------------------------- | ------------------------------------------------ |
| `/bs:new`                | Create new project (quality-only) | Starting greenfield project, framework-agnostic  |
| `/bs:dev`                | Smart feature development         | Starting new features with complexity assessment |
| `/bs:quality`            | 95% ship-ready quality loop       | Before creating PR (autonomous review/fix cycle) |
| `/bs:quality --level 98` | 98% production-perfect loop       | Critical releases requiring security/a11y/perf   |
| `/bs:hotfix`             | Emergency production fixes        | Production emergencies (5-10 min)                |
| `/bs:verify`             | Post-deploy verification          | Smoke tests with auto-rollback                   |
| `/bs:deps`               | Dependency health management      | Check outdated packages, security audit          |
| `/bs:test`               | Smart test runner                 | Auto-detects Jest/Vitest/Playwright              |
| `/bs:workflow`           | Daily workflow reference          | Quick command lookup                             |

**Example workflow:**

```bash
/bs:dev dark-mode          # Complexity assessment → plan → implement
/bs:test --watch           # TDD development
/bs:quality --merge        # Autonomous quality → PR creation
```

### Agent & Session (5)

| Command               | Purpose                    | When to Use                          |
| --------------------- | -------------------------- | ------------------------------------ |
| `/bs:session`         | Manage agent sessions      | Multi-day workflows (save/load/list) |
| `/bs:session --quick` | Quick context save/restore | Short breaks (auto-overwrites)       |
| `/bs:resume`          | Resume last session        | Auto-detect and continue work        |
| `/bs:agent-new`       | Create specialized agents  | Custom agent with Claude Agent SDK   |
| `/bs:agent-run`       | Run custom agents          | With session support                 |

### Newsletter & Social (2)

| Command     | Purpose              | When to Use                          |
| ----------- | -------------------- | ------------------------------------ |
| `/bs:image` | Generate images      | Newsletters, social media, carousels |
| `/bs:post`  | Post one message now | Custom or library, immediate posting |

### DevOps & Automation (5)

| Command          | Purpose                 | When to Use                                     |
| ---------------- | ----------------------- | ----------------------------------------------- |
| `/bs:git-sync`   | Full git workflow       | Commit + push + pull + docs + deploy + release  |
| `/bs:ralph-dev`  | Autonomous backlog loop | Multi-item execution with learning capture      |
| `/bs:ralph-next` | Graph backlog loop      | Reflect/decide routing + trajectory evidence    |
| `/bs:cleanup`    | AI CLI cache cleanup    | High memory/disk usage from Claude/Cursor/Codex |
| `/bs:sync-ai`    | Sync to other AI CLIs   | Share commands with Codex/Gemini                |

### Strategy & Planning (2)

| Command        | Purpose                              | When to Use                                           |
| -------------- | ------------------------------------ | ----------------------------------------------------- |
| `/bs:strategy` | Multi-LLM synthesis & advisory panel | Strategic decisions, debate mode, architecture review |
| `/bs:backlog`  | Project backlog management           | Value-based prioritization                            |

### Configuration & Maintenance (3)

| Command        | Purpose                | When to Use                        |
| -------------- | ---------------------- | ---------------------------------- |
| `/bs:sync`     | Config health checks   | Verify/repair Claude Code symlinks |
| `/bs:help`     | Command reference      | Quick lookup of all commands       |
| `/bs:maintain` | Self-maintaining setup | Quarterly audits, auto-fixes       |

### Release & Distribution (1)

| Command     | Purpose                       | When to Use                                                  |
| ----------- | ----------------------------- | ------------------------------------------------------------ |
| `/bs:scrub` | Scrub project for any release | `--mode opensource\|sell\|giveaway` (secrets, privacy, docs) |

### Root Commands (Utilities) (3)

| Command            | Purpose              | When to Use                                            |
| ------------------ | -------------------- | ------------------------------------------------------ |
| `/debug`           | Systematic debugging | When stuck on a thorny bug (Rule of Three)             |
| `/refactor`        | Code quality cleanup | jscpd (duplicates) + knip (dead code) + simplification |
| `/update-claudemd` | Update CLAUDE.md     | Capture learnings from session                         |

---

## Quality Automation Levels

| Command                        | Checks                                  | Use Case             |
| ------------------------------ | --------------------------------------- | -------------------- |
| `/bs:quality` (95%)            | Lint, types, tests, security, AI review | Standard PR workflow |
| `/bs:quality --level 98` (98%) | + perf, a11y, edge cases                | Production releases  |

**Both run autonomously** - no manual iteration needed.

---

## Typical Workflows

### New Feature Development

```bash
# 1. Start with complexity assessment
/bs:dev user-authentication

# This auto-triggers:
# - Simple: Direct implementation
# - Medium: Codebase exploration → plan → implement
# - Complex: EnterPlanMode → detailed planning → TDD

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
# Auto-creates PR when all checks pass
```

### Newsletter & Social

```bash
# Article creation is handled by OpenClaw
/bs:image newsletter.md --preset carousel  # LinkedIn carousel
/bs:post --newsletter buildproven  # Auto-post with cooldown
```

---

## Global Availability

All commands work in:

- Claude Code CLI (any directory)
- Claude Code Web UI (any repo)

**Setup**: Commands are symlinked from `claude-setup/commands/` to `~/.claude/commands/`

---

## Related Commands

### GitHub Commands

| Command         | Purpose                 |
| --------------- | ----------------------- |
| `/gh:review-pr` | Autonomous PR review    |
| `/gh:fix-issue` | GitHub issue resolution |

### Claude Code Commands

| Command              | Purpose                 |
| -------------------- | ----------------------- |
| `/cc:optimize`       | Cost optimization guide |
| `/cc:create-command` | Create new commands     |

---

## Getting Started

**New project?**

```bash
/bs:new my-project    # Create with quality infrastructure
cd my-project
/bs:dev my-feature    # Start feature work
```

**Ready to ship?**

```bash
/bs:quality --merge
```

**Strategic decision?**

```bash
/bs:strategy "Should we add feature X?"
```

**Config issues?**

```bash
/bs:sync --mode check
```

---

## Notes

- **No VBL pipeline here**: Commands like validate/build/ship/launch were product-specific and removed in CS-004 cleanup
- **Business commands**: `/vbl-revenue` and `/vbl-queue` live in the vibebuildlab project repo
- **Symlink-based**: Edit commands in `claude-setup/commands/`, changes apply globally
- **Version controlled**: All configs tracked in git for easy replication
