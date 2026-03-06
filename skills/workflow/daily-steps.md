# Workflow Daily Steps — Detailed Command Sequences

## Solo Dev (Default)

```bash
# 1. Start work
/bs:dev "feature name"
# Creates branch, assesses complexity, plans

# 2. Code
# ... make changes ...

# 3. Ship it (one command, fully automated)
/bs:quality --merge
# Auto-generates missing tests, runs quality agents
# Creates PR, merges, deploys

# 4. Next feature (start fresh)
/clear
/bs:dev "next feature"
```

## Team Collaboration

```bash
# 1. Start work
/bs:dev "feature name"

# 2. Code
# ... make changes ...

# 3. Create PR for review (no auto-merge)
/bs:quality
# Creates PR, ready for team review

# 4. After team approves & merges
/bs:git-sync --merge-only
# Switches to main, pulls, deploys
```

## Production Launch

```bash
# 1. Start work
/bs:dev "critical feature"

# 2. Code
# ... make changes ...

# 3. Production-perfect quality
/bs:quality --level 98 --merge --deploy
# 10 agents, accessibility, performance, architecture
# Auto-deploys after merge, verifies production

# 4. Next feature
/clear
```

## Emergency Hotfix

```bash
# Production is DOWN
/bs:hotfix "description of the issue"
# Minimal quality checks (5-10 min)
# Deployed and verified automatically

# Within 24 hours — clean up
/bs:quality --level 98 --scope all
```

## Rapid Iteration

```bash
# Small chunks
# ... code ...
/bs:quality --scope changed
# → 2-5 min, auto-commits

# ... code more ...
/bs:quality --scope changed
# → 2-5 min, auto-commits

# Feature complete — full check
/bs:quality --merge
# → 30-60 min, creates PR, merges, ships
```

## Git Flow

```bash
# Feature branch (no deploy)
/bs:dev "feature"       # → Creates feature/feature-name branch
# ... code ...
/bs:quality             # → Creates PR (no merge)

# Feature branch (with deploy)
/bs:dev "feature"       # → Creates feature/feature-name branch
# ... code ...
/bs:quality --merge     # → Creates PR, merges, deploys
```

## Newsletter & Social Media

```bash
# Article creation handled by your newsletter tool

# Post to social media
/bs:post "message"
# → Optimizes for each platform, posts to all
```

## Session Management

```bash
# Save session before leaving
/bs:session save

# Resume next day
/bs:resume
# Continues where you left off

# Recover from crash
/bs:context --restore
```

## Troubleshooting

```bash
# Debug failing tests/builds
/debug
# → Hypotheses → read code → strategic logging

# Check project health
/bs:status
# → Recent commits, open PRs, CI status, deps

# Quick readiness check
/bs:quality --preflight
# → <10 sec: uncommitted? tests? lint? build? secrets?

# View quality trends
/bs:quality --status --verbose
# → Coverage, issues, duration charts
```

## Command Quick Reference

| Command                   | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `/bs:dev`                 | Start development work                    |
| `/bs:quality`             | Quality loop (default: 95%, branch scope) |
| `/bs:quality --merge`     | Quality + auto-merge + deploy             |
| `/bs:quality --preflight` | Quick readiness check                     |
| `/bs:hotfix`              | Emergency production fix                  |
| `/bs:ralph-dev`           | Autonomous backlog iteration              |
| `/bs:status`              | Project catch-up                          |
| `/bs:dashboard`           | Full observability                        |
| `/bs:deps`                | Dependency health                         |
| `/bs:post`                | Social media post                         |
| `/bs:session`             | Session management                        |
| `/bs:context`             | Context recovery                          |
| `/bs:help`                | All commands reference                    |
