---
name: README
description: BS Commands — public command reference for claude-power-kit
tags: [help, reference, overview]
category: meta
model: haiku
---

# BS Commands

Public command reference for the curated `claude-power-kit` surface.

Commands use prefixes: `/bs:` (workflow), `/gh:` (GitHub), `/cc:` (Claude Code), or no prefix (utilities).

## Development & Quality

| Command | Purpose | When to Use |
| --- | --- | --- |
| `/bs:new` | Create a new project scaffold | Starting a greenfield repo |
| `/bs:init-project` | Initialize Claude workflow files | Retrofitting an existing repo |
| `/bs:dev` | Start feature development | Beginning implementation work |
| `/bs:plan` | Structure a larger task | Ambiguous or multi-step work |
| `/bs:test` | Run tests with sensible defaults | During implementation |
| `/bs:quality` | Run the quality loop | Before PR or merge |
| `/bs:hotfix` | Fast emergency path | Production incidents |
| `/bs:deps` | Check dependency health | Upgrade and audit work |
| `/bs:workflow` | Show the daily workflow | Quick lookup |

## Sessions, Context, Agents

| Command | Purpose | When to Use |
| --- | --- | --- |
| `/bs:session` | Save and restore work sessions | Multi-day tasks |
| `/bs:resume` | Resume recent work | Continue where you left off |
| `/bs:context` | Inspect context and checkpoints | Manage long sessions |
| `/bs:agent-new` | Create specialized agents | Adding a new agent role |
| `/bs:agent-run` | Run custom agents | Reuse existing agents |

## Backlog, Strategy, Maintenance

| Command | Purpose | When to Use |
| --- | --- | --- |
| `/bs:backlog` | Review next work | Prioritization and planning |
| `/bs:ralph` | Autonomous backlog execution | Multi-item execution |
| `/bs:strategy` | Advisory panel workflow | Strategic or architecture questions |
| `/bs:cleanup` | Clean AI CLI caches | Disk and state cleanup |
| `/bs:sentry` | Quality audit across repos | Fleet health checks |
| `/bs:steward` | Steward active projects | Ongoing follow-through |
| `/bs:sota` | Score setup maturity | Identify gaps and upgrades |
| `/bs:sync` | Verify or repair setup links | Local setup health |
| `/bs:status` | Show project status | Quick catch-up |
| `/bs:patterns` | Review code patterns | Spot risky or repeated patterns |
| `/bs:read` | Read and extract improvements | Learn from external material |
| `/bs:office-hours` | Fast help/status surface | Quick operator lookup |
| `/bs:help` | Show all commands | Reference |
| `/bs:scrub` | Prepare a repo for release | Open source, giveaway, or sell modes |

## Utilities

| Command | Purpose |
| --- | --- |
| `/debug` | Systematic debugging |
| `/refactor` | Cleanup and simplification |
| `/update-claudemd` | Capture learnings into `CLAUDE.md` |
| `/gh:review-pr` | Review a pull request |
| `/gh:fix-issue` | Work a GitHub issue |
| `/cc:optimize` | Optimize Claude Code usage |
| `/cc:create-command` | Create a new command |

## Notes

- This repo is the public core.
- Product, posting, sales, and private operator workflows are intentionally excluded.
- The authoritative command set is whatever exists under `commands/`.
