---
name: bs:retro
description: 'Data-driven retrospective from git history and PR activity'
argument-hint: '[--period 7d|14d|30d] [--project <name>] [--all] → structured retro'
tags: [workflow, retrospective, reflection, improvement]
category: maintenance
model: sonnet
---

# /bs:retro - Data-Driven Retrospective

**Usage**: `/bs:retro [--period 7d|14d|30d] [--project <name>] [--all]`

Analyze recent git history and GitHub activity to produce a quantified, evidence-based retrospective. No vibes — data and specific commits/PRs only.

**Default period**: 7 days

## Step 1: Gather Data

```bash
PERIOD="${1:-7d}"
DAYS=$(echo "$PERIOD" | sed 's/d//')
SINCE=$(date -v-${DAYS}d +%Y-%m-%d 2>/dev/null || date -d "$DAYS days ago" +%Y-%m-%d)
```

If `--all` flag, iterate over all repos in `~/Projects/` that have commits in period.
If `--project`, cd to that project directory.
Otherwise, use current git repo.

### Git Data

```bash
# Commit log with timestamps and file stats
git log --since="$SINCE" --format="%H|%ai|%s" --shortstat

# Files changed frequency (hotspot detection)
git log --since="$SINCE" --name-only --format="" | sort | uniq -c | sort -rn | head -20

# Hourly distribution
git log --since="$SINCE" --format="%H %ai" | awk '{print substr($2,12,2)}' | sort | uniq -c | sort -k2

# Fix-chain detection (consecutive fix: commits)
git log --since="$SINCE" --format="%s" | grep -c "^fix:"

# Authors (for multi-contributor repos)
git log --since="$SINCE" --format="%an" | sort | uniq -c | sort -rn
```

### GitHub Data

```bash
# PR cycle time (open to merge)
gh pr list --state merged --search "merged:>=$SINCE" --json number,title,createdAt,mergedAt,additions,deletions

# Open PRs (stale detection)
gh pr list --state open --json number,title,createdAt,labels

# Recent issues closed
gh issue list --state closed --search "closed:>=$SINCE" --json number,title,closedAt
```

## Step 2: Analyze Patterns

### Quantified Metrics

Calculate and report:

| Metric            | Value                            | Trend              |
| ----------------- | -------------------------------- | ------------------ |
| Commits           | count                            | vs previous period |
| Lines changed     | +/-                              | vs previous period |
| PRs merged        | count                            | vs previous period |
| Avg PR cycle time | hours                            | vs previous period |
| Fix commit ratio  | fix: / total                     | lower is better    |
| Test file ratio   | test files / total files changed | higher is better   |

### Hotspot Analysis

Files changed 5+ times in the period signal either:

- **Active development** (expected for new features)
- **Architectural weakness** (unexpected churn = incomplete design)
- **Config thrashing** (multiple PRs touching same config)

Flag any file with 5+ changes and categorize.

### Fix-Chain Detection

Sequences of `fix:` commits after a `feat:` commit indicate:

- Review gap (feature shipped without adequate review)
- Scope underestimation (feature was more complex than planned)
- Test gap (bugs caught after merge, not before)

Flag any sequence of 3+ fix commits targeting the same area.

### Session Patterns

From commit timestamps:

- **Peak hours**: When are you most productive?
- **Late-night clusters**: 3+ commits after 11pm = burnout risk
- **Long sessions**: 5+ hours without break = diminishing returns
- **Weekend work**: Flag but don't judge — context matters

## Step 3: Generate Report

```markdown
## Retrospective: [Project Name] — [Date Range]

### By the Numbers

[Metrics table from Step 2]

### Top 3 Wins

[Concrete achievements citing specific commits/PRs]

- Example: "Shipped auth middleware overhaul (PR #142) — 3 clean commits, zero fix-chain, merged same day"

### Top 3 Growth Areas

[Investment-framed, not blame-framed]

- Example: "Test coverage on payments module dropped to 62% — worth investing 2 hours before next feature lands"
- Example: "5 fix commits on api/routes.ts after initial merge — consider running /bs:quality before PR next time"

### Hotspots

[Files with 5+ changes, categorized]

### Pattern Observations

[Session timing, fix chains, any concerning trends]

### One Action Item

[Single most impactful thing to change in the next period]

- Must be specific and actionable
- Must be completable in one session
- Example: "Add integration tests for the checkout flow before building the next payment feature"
```

## Step 4: Compare Trends (if previous retro exists)

Check for previous retro output in project's `docs/` or Linear. If found, compare:

- Are growth areas from last retro improving?
- Did the action item get done?
- Any new patterns emerging?

## Notes

- **Praise is concrete**: Not "great work" but "Cleaned up the entire auth module in 3 small, reviewable PRs — textbook decomposition"
- **Growth is investment-framed**: Not "you have bad test coverage" but "Test coverage on payments is at 62% — worth investing before the next feature lands"
- **100% test coverage is the goal**: Tests make vibe coding safe. Flag declining coverage explicitly.
- For `--all` mode: produce a summary across all active repos, then per-repo breakdowns for repos with significant activity
