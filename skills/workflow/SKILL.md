---
name: workflow
description: Daily development workflow reference. Quick-start guides for solo dev, team collaboration, production launches, and emergency hotfixes. Points to detailed steps in supporting files.
---

# Workflow Skill — Daily Development Guide

Quick reference for all development workflows. Read `daily-steps.md` for detailed command sequences.

## Quick Start

```bash
/bs:dev "feature name"    # Start work
# ... code ...
/bs:quality --merge       # Ship it
/clear                    # Fresh context
```

## Workflow Selection

| Scenario                  | Commands                                                                      | Time              |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------- |
| Solo dev (fast iteration) | `/bs:dev` → code → `/bs:quality --merge`                                      | 30-60 min         |
| Team collaboration        | `/bs:dev` → code → `/bs:quality` → team reviews → `/bs:git-sync --merge-only` | Varies            |
| Production launch         | `/bs:dev` → code → `/bs:quality --level 98 --merge --deploy`                  | 1-3 hours         |
| Emergency hotfix          | `/bs:hotfix "description"`                                                    | 5-10 min          |
| Rapid iteration           | code → `/bs:quality --scope changed` (repeat) → `/bs:quality --merge`         | 2-5 min per chunk |

## Autonomous Mode

```bash
/bs:ralph-dev                    # Work through 10 backlog items
/bs:ralph-dev --until "4 hours"  # Time-boxed autonomous work
/bs:ralph-dev --teams            # Parallel with agent teams
```

## Content & Marketing

```bash
# Article creation handled by OpenClaw
/bs:post "message"               # Post to social media
/bs:image file.md --preset beehiiv  # Generate images
```

## Strategy & Reflection

```bash
/bs:office-hours "idea"          # YC forcing questions for product evaluation
/bs:retro                        # Data-driven retrospective from git history
/bs:retro --period 30d --all     # Cross-project monthly retro
/bs:strategy "question"          # Multi-model advisory panel
```

## Maintenance

```bash
/bs:status                       # Catch up after time away
/bs:deps --audit                 # Check dependency health
/bs:retro --period 7d            # Weekly retrospective
```

## Context Management

**Session Length Best Practices:**

- **Target: < 50 turns per session** — Break at natural boundaries
- **Warning signs:** Session slowing down, repeated questions, context compression messages
- **Break pattern:** `/bs:dev` → code → `/bs:quality` → `/clear` → next feature

**Commands:**

- `/compact` at milestones (after commits, before quality)
- `/clear` between features
- `/bs:resume` to continue sessions
- `/bs:context` to recover from crashes

**Why short sessions matter:** After ~50 turns, context compression kicks in repeatedly, losing detail and wasting tokens. A 545-turn session generates 380MB of transcript. Should be 5-10 focused chunks instead.

## Supporting Files

- `daily-steps.md` — Detailed step-by-step command sequences for each workflow
