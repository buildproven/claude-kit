---
name: bs:sota
description: Repeatable SOTA system scorecard — scores, self-heals to 9/10 minimum, commits fixes
argument-hint: '[--gaps] [--history] [--score-only] → always self-heals by default'
tags: [system, assessment, scorecard, sota]
category: system
model: opus
---

# /bs:sota - System SOTA Assessment + Self-Heal

**Arguments received:** $ARGUMENTS

Repeatable scorecard that rates your Claude Code setup against state-of-the-art benchmarks. **Self-heal runs by default** — any category below 9/10 gets fixed automatically until the floor is met.

## Flags

| Flag           | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `--score-only` | Score only — skip self-heal, just show the scorecard           |
| `--gaps`       | Show detailed improvement suggestions per category (then heal) |
| `--history`    | Show score trend over time from sota-history.json              |
| (default)      | Score + self-heal all categories below 9/10 + commit fixes     |

## Target Floor

**Every category must reach 9/10.** After scoring, implement fixes for all categories below 9. Re-score after fixes. Repeat until all categories are ≥9 or no further auto-fixes are possible (propose blockers to user).

## Assessment Process

### Step 0: Rubric Refresh + Fetch Latest CC Features

**Rubric version: 2.0 | Last reviewed: 2026-03-21**

**0a) Rubric staleness check** — if `last_reviewed` is >30 days ago:

1. Search: `"Claude Code best practices 2026"`, `"Claude Code new features changelog site:github.com/anthropics/claude-code"`, `"AI coding assistant setup scoring"`
2. Check CC release notes for new capabilities (new hook types, new settings, new agent features)
3. Compare current 13-category rubric against findings — are there new categories that should exist? Are any benchmarks outdated?
4. Propose rubric changes (new categories, adjusted 10/10 benchmarks, removed obsolete checks)
5. Update `last_reviewed` date and `rubric_version` after applying changes

If <30 days, just do 0b.

**0b) Feature scan** — always run:

Search for recent Claude Code updates:

- `Claude Code new features changelog site:github.com/anthropics/claude-code`
- `Claude Code slash commands reference 2026`

Output a brief "What's New in CC" section (3-5 items, flag any that affect scoring).

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

### Step 2: Rate 13 Categories

Score each category 1-10 against the benchmarks below. Be objective — deduct for missing items.

| #   | Category                   | What SOTA Looks Like (10/10)                                                                                                                                        | Key Files to Check                                                               |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **CLAUDE.md**              | <100 lines, covers: action defaults, code style, quality standards, communication, tools, deployment, config mgmt, error handling. No bloat.                        | `config/CLAUDE.md`                                                               |
| 2   | **Settings & Permissions** | Granular allow/deny/ask. Deny destructive ops. Ask for secrets reads. No blanket `Bash(*)`.                                                                         | `config/settings.json` permissions                                               |
| 3   | **Hooks**                  | PostToolUse (lint+security on edit), PreToolUse (block push main), PreCompact (backup), TeammateIdle, TaskCompleted. 5+ hook types.                                 | `config/settings.json` hooks                                                     |
| 4   | **Skills**                 | 15+ skills. Mix of auto-invoke + manual. Heavy skills use `context: fork`. Dynamic context injection.                                                               | `skills/*/SKILL.md`                                                              |
| 5   | **Commands**               | 25+ commands. Proper frontmatter (name, description, tags, category). <150KB total. Organized by prefix.                                                            | `commands/**/*.md`                                                               |
| 6   | **Infrastructure Hygiene** | No unused MCP plugins. No dead scripts (0 unreferenced). Repo <300MB. No orphan root files. No empty/stale ~/Projects dirs. repo-hygiene module returns 0 findings. | `config/settings.json` enabledPlugins, `scripts/steward/modules/repo-hygiene.sh` |
| 7   | **Quality Gates**          | Autonomous quality loop. Lint + typecheck + test + build + security scan. Pattern analysis. Auto-merge flow.                                                        | `commands/bs/quality.md`, `skills/quality/`                                      |
| 8   | **Autonomous Dev**         | Ralph with autonomous backlog execution, learning capture, and fresh context per item.                                                                               | `commands/bs/ralph.md`                                                           |
| 9   | **Security**               | Gitleaks in hooks, semgrep rules, pattern-check.sh, deny list for destructive commands, secrets in env vars only.                                                   | `.semgrep/`, `scripts/pattern-check.sh`, hooks                                   |
| 10  | **Git Workflow**           | Pre-commit (lint-staged), pre-push (typecheck + branch naming), conventional commits, auto-rollback, branch hygiene.                                                | `.husky/`, `commitlint.config.*`                                                 |
| 11  | **Documentation**          | CLAUDE.md + backlog (Linear or BACKLOG.md) + command help + skill docs. Auto-doc detection in quality. Cheatsheet. Session learnings.                               | `docs/`, Linear                                                                  |
| 12  | **Portability**            | Submodule-ready. Install script. Symlink management. Cross-project sync. Setup smoke test.                                                                          | `install.sh`, `scripts/setup-claude-sync.sh`                                     |
| 13  | **Tool Currency**          | Zero outdated global tools (`npm outdated -g` clean). CC plugins at latest. brew tools current. Vercel CLI, OpenClaw, gh all latest.                                | `npm outdated -g`, `brew outdated`, plugin cache                                 |

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

Append result to `$SETUP_REPO/data/sota-history.json` (the shared repo history file):

```json
{
  "version": "1.0",
  "lastUpdated": "2026-02-08",
  "entries": [
    {
      "date": "2026-02-08",
      "overall": 8.2,
      "scores": { "claude_md": 9, "settings": 8 },
      "topGaps": ["No env block", "Cross-platform testing"]
    }
  ]
}
```

Read the existing file, append the new entry to `entries[]`, update `lastUpdated` to today's date, and write back. Keep all historical entries (no rolling limit — file is small). Also append to `.claude/sota-history.json` for backward compatibility.

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

For each category scoring <9, show before healing:

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

---

### Step 7: Self-Heal to 9/10 Floor (ALWAYS runs unless `--score-only`)

**Target: every category must reach ≥9/10. Implement fixes until all categories are healed or no further auto-fixes are possible.**

#### 7.1 Identify All Categories Below 9

List every category scoring <9 with:

- Current score
- Gap to 9/10
- Specific fixable items (be concrete — file paths, config keys, exact changes)

#### 7.2 Risk-Tiered Auto-Fix (all tiers now auto-apply)

**Tier 1 — Low-risk (file/config edits):**

- Add `context: fork` to skills > 200 lines
- Update frontmatter on commands missing description/tags
- Add missing hook types to settings.json
- CLAUDE.md: trim to <100 lines, add missing sections
- Commit frontmatter, add missing patterns to pattern-check.sh
- Add missing auto-invoke triggers to skills that have natural activation signals

**Tier 2 — Medium-risk (behavioral changes, model routing):**

- Edit CLAUDE.md behavioral rules based on gaps
- Add/update command logic to close scoring gaps
- Add MCP server entries to settings.json for servers that are actively used but not configured
- Add portability scripts (install.sh, setup-claude-sync.sh) if missing

**Tier 3 — High-risk (propose only, don't auto-apply):**

- Merging or deleting commands (destructive, needs human review)
- Removing permission rules from settings.json
- Changing cron model assignments

For Tier 1 and 2: implement immediately, no confirmation needed. Show what you changed.
For Tier 3: list proposals with rationale. Don't apply.

#### 7.3 Heal Loop

After applying Tier 1+2 fixes, re-score the affected categories mentally. If any are still <9, identify remaining blockers:

- If fixable with another auto-action → do it
- If blocked by Tier 3 (needs human) → note it and move on
- If score is already ≥9 → mark healed

Continue until all healable categories are ≥9 or only Tier 3 blockers remain.

#### 7.4 Output Self-Heal Summary

```
🔧 SELF-HEAL ACTIONS (targeting 9/10 floor)
=============================================
Categories below 9 before heal: [list]

Applied automatically:
  ✅ [Category] (N/10 → 9/10): [what was changed, file:line]
  ✅ [Category] (N/10 → 9/10): [what was changed]

Proposals (Tier 3 — needs human approval):
  📋 [Category] still at N/10: [why blocked] → [proposed action]

Floor status after heal:
  ✅ All auto-healable categories now ≥9/10
  ⚠️ N categories still below 9 — blocked on Tier 3 proposals above
```

#### 7.5 Commit the Changes

After applying all auto-fixes:

```bash
git add -A
git commit -m "chore(sota): self-heal to 9/10 floor $(date +%Y-%m-%d)

Categories healed: [list with before→after scores]
Tier 3 proposals pending: [count]

Score before: X.X | After: Y.Y"
```

Then show the final re-scored table (Steps 1-4 output) with updated scores.
