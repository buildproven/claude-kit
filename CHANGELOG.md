# Changelog

All notable changes to claude-setup will be documented in this file.

## [Unreleased]

### Added

- `/bs:read` command for reading articles and extracting actionable setup improvements
- `/bs:ralph-next` command with graph orchestration (`PICK -> IMPLEMENT -> QUALITY -> REFLECT -> DECIDE`)
- `scripts/ralph-next-run.sh` Phase 2 runner with local quality checks, retry routing, and evidence logging
- `scripts/test-ralph-next.sh` reliability checks for pass, retry, and escalation behavior
- "When to Work Manually vs. Delegate" guidance in global CLAUDE.md
- "Update docs with code changes" quality rule in global CLAUDE.md
- Backlog Quality Gate lesson (prevent building unused features)
- safe_push helper in git-sync for block-push-main hook

### Removed

- Pilot analytics mode (CS-040) and engage mode (CS-042) — unused, removed in cleanup
- VS Code defensive patterns extension (CS-092) — never compiled or used
- Pattern metrics dashboard (CS-088), learn-from-audits (CS-091), auto-learn (CS-089) — unused scripts
- ~3,100 lines of dead code total

## [4.8.0] - 2026-02-06

### Added

- Auto-invoke skills for tests, errors, and API conventions (CS-095/096/097)
- ~~VS Code extension for defensive patterns (CS-092)~~ _(removed in next release)_
- ~~Pilot engage mode for comment engagement (CS-042)~~ _(removed in next release)_
- Pattern compliance metrics dashboard (CS-088)
- Semgrep integration for deeper security analysis (CS-090)
- ~~Auto-learn mode for pattern discovery (CS-089)~~ _(removed in next release)_
- ~~Learn-from-audits script (CS-091)~~ _(removed in next release)_
- ~~Pilot analytics mode for content performance tracking (CS-040)~~ _(removed in next release)_
- Deep claude-hud integration for real-time visibility (CS-061)
- Automated rollback on production failures (CS-060)
- Auto-documentation from code changes (CS-059)
- Agent learning integration (CS-073)
- Cross-project pattern search (CS-072)
- Monetize skill for commercial launch automation (CS-037)
- Deployment rollback with configurable health checks (CS-074)
- ESLint defensive patterns plugin (CS-086)
- Per-project pattern configuration (CS-087)
- Defensive pattern analysis pre-commit hook (CS-085)
- Learnings promotion pipeline (CS-070)
- Pattern metadata schema with versioning (CS-071)
- Auto-checkpoint before compact (CS-068)
- Pre-merge conflict detection (CS-083)
- Per-agent cost tracking (CS-081)
- Agent result validation (CS-079)
- Coverage diff tracking per file (CS-078)
- Pre-push CI validation (CS-075)
- Error pattern detection for ralph-dev (CS-066)
- SOTA alerts, test gates, recovery (CS-065, CS-077, CS-084)

### Changed

- Simplified command model strategy: opus default for all commands except 3 static display commands (haiku)
- Enabled GitHub plugin (CS-099)
- Removed 21 broken/unnecessary symlinks
- Updated model pricing defaults for Opus 4.6
- Rewrote global CLAUDE.md for Anthropic best practices

### Fixed

- Resume context summary display for quick checkpoints (CS-067)
- Backlog sync with 27 completed items

## [4.7.0]

### Added

- **CI Failure Recovery** in `/bs:ralph-dev` - Hybrid auto-fix + backlog approach for lint/type errors
- `/bs:status` command for project catch-up summaries (CS-048)
- `--preflight` flag for quick readiness check (CS-047)
- Next-step guidance in command exits (CS-046)
- ASCII trend charts in `/bs:quality --status --verbose` (CS-058)
- `/bs:patterns` command for searching CLAUDE.md patterns (CS-057)
- Enhanced `/bs:resume` with context summary (CS-056)
- Real-time cost tracking per feature via `/bs:cost` (CS-055)
- `/bs:monetize` skill stub (CS-037 MVP)
- Auto-release workflow prompt in `/bs:git-sync`
- `--deep` flag for `/bs:quality --audit`
- Branch hygiene in `/bs:dev` and `/bs:ralph-dev`
- CS-015: Autonomous test/doc coverage detection for `/bs:quality` loop
  - Test coverage check for changed code
  - CLI help text sync verification
  - README API doc consistency check
  - BACKLOG completion tracking
- QA Architect integration in `/bs:new` command with workflow tier selection (minimal/standard/comprehensive)
- `--scope` flag for `/bs:quality` with three options: changed (2-5 min), branch (30-60 min), all (45-90 min)
- Incremental quality checks via `--scope changed` for rapid commit-by-commit workflow
- Automatic submodule update notifications via GitHub Actions (weekly checks, creates PRs)
- Quality history tracking in `.qualityrc.json` (lastReady for 95%, lastPerfect for 98%)
- `/bs:quality --status` flag for viewing quality run history
- Shell alias `claude-skip` for `--dangerously-skip-permissions` flag
- CS-005 to CS-013: Nine new backlog items from SOTA analysis (testing, deps, quality consolidation, etc.)
- Submodule setup across 6 repos for global command access in CLI and Web UI
- Comprehensive audit reports (content-audit, cleanup-proposal)
- /bs:maintain command for self-maintaining setup (health checks, audits, optimization)
- Sequential Thinking MCP server integration
- Submodule-based installation for commands (install-via-submodule.sh)
- Quick start guide for adding commands to repos (QUICK_START.md)
- Guide for using commands across repos in Web UI (HOW_TO_USE_COMMANDS_EVERYWHERE.md)
- Submodule setup documentation (SUBMODULE_SETUP.md)
- CS-004 backlog item for business IP separation
- BACKLOG.md with prioritized items using value-based scoring

### Changed

- **BREAKING**: `/bs:ready` and `/bs:perfect` consolidated into `/bs:quality` with `--level` flag
- CLAUDE_CODE_OPTIMIZATION_GUIDE.md workflow now matches actual `/bs:workflow` (was showing wrong generic commands)
- Commands reduced from 16 to 14 focused commands (quality command consolidation)
- All documentation updated to reference `/bs:quality` instead of ready/perfect
- /bs:strategy now uses direct multi-LLM API calls (removed VBL CLI dependency)
- /bs:git-sync uses environment variables instead of hardcoded paths
- Optimization guide updated with real usage data showing 75% cost reduction
- CS-002 and CS-004 marked complete in backlog
- Re-enabled Serena plugin alongside Sequential Thinking MCP

### Removed

- CS-014: Manual checklist approach (replaced with CS-015 autonomous version)
- `/bs:ready` command (use `/bs:quality` instead)
- `/bs:perfect` command (use `/bs:quality --level 98` instead)
- `/bs:quality-status` command (use `/bs:quality --status` instead)
- 8 VBL pipeline commands: validate, build, ship, launch, grow, run, project, monitor
- 4 deprecated commands from \_archive/
- 2 business commands moved to your-project repo: revenue, queue

## [2.0.0] - 2025-11-26

### Major Refactor - Lean & Mean Edition

Complete consolidation from 29 commands to 10 lean, powerful commands.

### Changed

- **Commands**: 29 → 10 commands (66% reduction)
- **Lines deleted**: 15,189 lines removed
- **Focus**: Quality over quantity

### New Commands

- `/execute` - V-Cycle development (quick/full/backlog modes)
- `/review` - Multi-dimensional project review
- `/monitor` - Production monitoring & optimization
- `/sync` - Claude setup synchronization
- `/social` - Social media auto-posting
- `/project` - Project status from private repo
- `/monetize` - SaaS monetization setup
- `/git-sync` - Complete git workflow automation
- `/eureka` - Capture technical breakthroughs

### Added

- `install.sh` - One-liner installer for new computers
- `setup-claude-sync.sh` - Complete portable setup script
- Symlink-based configuration management
- 280+ permission rules with security deny list

### Removed

- Legacy framework complexity
- Redundant mode files (MODE\_\*.md)
- Overlapping commands
- Kiro-specific commands

---

## [1.5.0] - 2025-11-25

### Added

- MCP server integrations (sequential-thinking, playwright, memory)
- Skills setup (PDF, XLSX, DOCX, PPTX)
- Social credentials restore script
- Cross-computer sync automation

### Changed

- Single source of truth: settings.json (not env variables)
- CLAUDE.md moved to claude-setup (symlinked)

---

## [1.0.0] - 2025-11-20

### Initial Release

- Custom Claude Code framework
- Business panel experts
- Project management integration
- Private repo sync capabilities
- Custom commands structure
- Agent definitions

---

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes to command structure or workflow
- **MINOR**: New features, commands, or capabilities
- **PATCH**: Bug fixes, documentation updates
