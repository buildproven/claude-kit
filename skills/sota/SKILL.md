---
name: sota
description: SOTA system assessment skill. Auto-invokes when user asks "how's my setup?", "rate my system", "am I SOTA?", "score my config", "audit my Claude setup", or similar assessment questions. Provides consistent, repeatable scoring against defined benchmarks.
---

# SOTA Assessment Skill

Consistent, repeatable scorecard for Claude Code setups. Delegates to `/bs:sota` for the full workflow.

## When This Activates

- "How's my setup?"
- "Rate my system"
- "Am I SOTA?"
- "Score my config"
- "Audit my Claude Code setup"
- Any setup quality/rating question

## Quick Assessment

When auto-invoked, run a lightweight version:

1. Count: skills, commands, hooks, plugins, CLAUDE.md lines
2. Check key indicators: hooks configured? quality command exists? ralph exists? security hooks?
3. Give a quick 1-line verdict with overall score estimate

Then suggest: "Run `/bs:sota` for a full detailed scorecard, or `/bs:sota --gaps` for improvement suggestions."

## Scoring Rubric

### Score Thresholds

| Score | Label      | Criteria                                  |
| ----- | ---------- | ----------------------------------------- |
| 10    | SOTA       | Best-in-class, nothing meaningful to add  |
| 8-9   | Excellent  | Production-grade, minor polish items only |
| 6-7   | Good       | Functional with clear improvement paths   |
| 4-5   | Fair       | Basic setup, missing key automation       |
| 1-3   | Needs Work | Minimal configuration, manual workflows   |

### Category Weights (all equal)

All 12 categories weighted equally. Overall = average of all category scores.

### Key Benchmarks

**CLAUDE.md (10/10):** <100 lines, 8+ sections (action defaults, code style, quality, communication, tools, deployment, config mgmt, error handling), no project-specific content in global config.

**Settings (10/10):** Granular permissions with allow/deny/ask separation, deny destructive ops, ask for secret file reads, env vars for feature flags, autoApproveEdits, alwaysThinking.

**Hooks (10/10):** 5+ hook types (PostToolUse, PreToolUse, PreCompact, TeammateIdle, TaskCompleted), lint on edit, security on edit, block push to main, transcript backup.

**Skills (10/10):** 15+ skills, 5+ auto-invoke, heavy skills use `context: fork`, dynamic context injection.

**Commands (10/10):** 25+ commands, all have frontmatter (name, description, tags, category), total size <150KB, organized by prefix (bs:, gh:, cc:).

**MCP Servers (10/10):** 5+ active servers, no obviously unused servers enabled, health checks available.

**Quality Gates (10/10):** Autonomous loop with lint + typecheck + test + build + security. Pattern analysis. Auto-merge flow. Coverage tracking.

**Autonomous Dev (10/10):** Ralph with learning capture, fresh context, and autonomous backlog execution.

**Security (10/10):** Gitleaks in hooks, semgrep rules, pattern-check.sh, deny list for destructive commands, secrets env-only, pre-commit pattern check.

**Git Workflow (10/10):** Pre-commit checks, pre-push checks, conventional commits, and branch hygiene.

**Documentation (10/10):** CLAUDE.md + BACKLOG.md + help command + skill docs + cheatsheet + session learnings. Auto-doc detection in quality loop. Changelog.

**Portability (10/10):** Submodule-ready with install.sh. Symlink management (setup-claude-sync.sh). Cross-project sync (/bs:sync). Setup smoke test. GitHub Actions for submodule updates.
