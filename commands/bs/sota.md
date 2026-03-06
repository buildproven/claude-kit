---
name: bs:sota
description: Repeatable SOTA system scorecard — rate your Claude Code setup against benchmarks
argument-hint: '[--gaps] [--history] → SOTA assessment'
tags: [system, assessment, scorecard, sota]
category: system
model: haiku
---

# /bs:sota - System SOTA Assessment

**Arguments received:** $ARGUMENTS

Repeatable scorecard that rates your Claude Code setup against state-of-the-art benchmarks. Same inputs = same scores.

## Flags

| Flag        | Description                                        |
| ----------- | -------------------------------------------------- |
| `--gaps`    | Show detailed improvement suggestions per category |
| `--history` | Show score trend over time from sota-history.json  |
| (default)   | Summary table with scores, verdicts, and top gaps  |

## Assessment Process

### Step 1: Scan Configuration

Gather data from these sources (read files, count entries):

```
settings.json       → hooks, permissions, plugins, env vars
skills/             → count, auto-invoke count, context:fork usage
commands/            → count, frontmatter completeness
scripts/             → count, categories
config/CLAUDE.md     → line count, section coverage
.husky/              → hook types configured
```

### Step 2: Rate 12 Categories

Score each category 1-10 against the benchmarks below. Be objective — deduct for missing items.

| #   | Category                   | What SOTA Looks Like (10/10)                                                                                                                 | Key Files to Check                             |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | **CLAUDE.md**              | <100 lines, covers: action defaults, code style, quality standards, communication, tools, deployment, config mgmt, error handling. No bloat. | `config/CLAUDE.md`                             |
| 2   | **Settings & Permissions** | Granular allow/deny/ask. Deny destructive ops. Ask for secrets reads. No blanket `Bash(*)`.                                                  | `config/settings.json` permissions             |
| 3   | **Hooks**                  | PostToolUse (lint+security on edit), PreToolUse (block push main), PreCompact (backup), TeammateIdle, TaskCompleted. 5+ hook types.          | `config/settings.json` hooks                   |
| 4   | **Skills**                 | 15+ skills. Mix of auto-invoke + manual. Heavy skills use `context: fork`. Dynamic context injection.                                        | `skills/*/SKILL.md`                            |
| 5   | **Commands**               | 25+ commands. Proper frontmatter (name, description, tags, category). <150KB total. Organized by prefix.                                     | `commands/**/*.md`                             |
| 6   | **MCP Servers**            | 5+ useful servers. Health checks configured. No unused servers consuming tokens.                                                             | `config/settings.json` enabledPlugins          |
| 7   | **Quality Gates**          | Autonomous quality loop. Lint + typecheck + test + build + security scan. Pattern analysis. Auto-merge flow.                                 | `commands/bs/quality.md`, `skills/quality/`    |
| 8   | **Autonomous Dev**         | Ralph-dev with retry loops, CI recovery, learning capture, fresh context per item. Agent teams option.                                       | `commands/bs/ralph-dev.md`                     |
| 9   | **Security**               | Gitleaks in hooks, semgrep rules, pattern-check.sh, deny list for destructive commands, secrets in env vars only.                            | `.semgrep/`, `scripts/pattern-check.sh`, hooks |
| 10  | **Git Workflow**           | Pre-commit (lint-staged), pre-push (typecheck + branch naming), conventional commits, auto-rollback, branch hygiene.                         | `.husky/`, `commitlint.config.*`               |
| 11  | **Documentation**          | CLAUDE.md + BACKLOG.md + command help + skill docs. Auto-doc detection in quality. Cheatsheet. Session learnings.                            | `docs/`, `BACKLOG.md`                          |
| 12  | **Portability**            | Submodule-ready. Install script. Symlink management. Cross-project sync. Setup smoke test.                                                   | `install.sh`, `scripts/setup-claude-sync.sh`   |

### Step 3: Output Format

```
🎯 CLAUDE CODE SOTA SCORECARD
==============================
Date: YYYY-MM-DD | Project: [name]

| # | Category            | Score | Verdict              | Top Gap                    |
|---|---------------------|-------|----------------------|----------------------------|
| 1 | CLAUDE.md           | 9/10  | ✅ Excellent         | —                          |
| 2 | Settings            | 8/10  | ✅ Strong            | No env block for secrets   |
| ...
| 12| Portability         | 7/10  | ⚠️ Good              | No cross-platform testing  |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVERALL: 8.2/10 — Strong setup, 3 gaps to close

Legend: ✅ 8+ Excellent | ⚠️ 6-7 Good | 🔶 4-5 Fair | ❌ <4 Needs Work
```

### Step 4: Save History (always)

Append result to `.claude/sota-history.json`:

```json
{
  "assessments": [
    {
      "date": "2026-02-08",
      "overall": 8.2,
      "scores": { "claude_md": 9, "settings": 8, ... },
      "topGaps": ["No env block", "Cross-platform testing"]
    }
  ]
}
```

### Step 4.5: Write Report File (always)

Write the full rendered scorecard (everything shown to user in Steps 3/5/6) to `$SETUP_REPO/data/sota-report.md`.

**Rolling file format — keep last 3 assessments:**

```markdown
# SOTA Reports

<!-- Last 3 assessments, newest first -->

## YYYY-MM-DD

[Full scorecard output from Step 3]
[Gap suggestions if --gaps was used]

---

## YYYY-MM-DD (previous)

[Previous scorecard]

---

## YYYY-MM-DD (oldest)

[Oldest kept scorecard]
```

**Rules:**

- Read existing `data/sota-report.md` if it exists
- Parse sections by `## YYYY-MM-DD` headers
- Prepend the new assessment
- Keep only the 3 most recent sections, delete older ones
- Create `data/` directory if it doesn't exist

### Step 5: If `--gaps` — Detailed Suggestions

For each category scoring <9, show:

```
📋 IMPROVEMENT SUGGESTIONS
===========================

## Settings & Permissions (8/10 → 10/10)
- Add `env` block to settings.json for AGENT_TEAMS and other feature flags
- Add ask rule for `Bash(npm publish:*)`

## Portability (7/10 → 10/10)
- Add Linux compatibility test in setup smoke test
- Document Windows/WSL setup path
```

### Step 6: If `--history` — Show Trend

```
📈 SOTA SCORE HISTORY
=====================
2026-01-24: 6.5/10 ████████████░░░░░░░░
2026-02-03: 7.5/10 ███████████████░░░░░
2026-02-07: 8.0/10 ████████████████░░░░
2026-02-08: 8.2/10 ████████████████░░░░

Trend: +1.7 over 15 days (+0.11/day)
Best category: Quality Gates (10/10 since 2026-02-03)
Most improved: Hooks (5 → 9, +4 points)
```
