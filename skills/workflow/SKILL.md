---
name: workflow
description: Daily development workflow reference. Quick-start guides for solo dev, team collaboration, production launches, and emergency hotfixes. Points to detailed steps in supporting files.
user-invocable: false
---

# Workflow Skill — Daily Development Guide

Quick reference for all development workflows. Read `daily-steps.md` for detailed command sequences.

## Quick Start

```bash
/bs:dev "feature name"    # Start work — creates a worktree, never edits on main
# ... code ...
/bs:quality --merge       # Ship it — runs review, merges PR, returns to main, removes worktree
/clear                    # Fresh context
```

## Worktree Discipline (NON-NEGOTIABLE)

The primary checkout is **inspection-only**. Never edit, commit, or stage on the
primary checkout's `main` branch. Every piece of work happens in a linked
worktree on a feature branch.

```bash
# Create a canonical worktree (preferred — `/bs:dev` does this for you)
node scripts/worktree-manager.js create \
  --repo /path/to/repo --branch <type>/<slug> \
  --creator manual --purpose "<task>"

# Inspect lifecycle state or reconcile after a manual/admin merge
node scripts/worktree-manager.js status --repo /path/to/repo
node scripts/worktree-manager.js reconcile --repo /path/to/repo --apply
```

Worktrees live at
`<primary-repo-parent>/.worktrees/<repo-name>/<branch-slug>`, outside the
repository so recursive searches, linters, secret scans, IDEs, and backups do
not accidentally traverse another checkout. Resolution always starts from the
primary checkout's Git common directory, even when invoked in a linked
worktree.

`/bs:quality --merge` MUST handle the cleanup tail. If you ever find yourself
with uncommitted changes on the primary checkout's `main`, stop, stash, create
the worktree, and pop the stash there — do not proceed in-place.

After a crash, `status` reports the native lock and owning invocation. Release
only with the exact owner, then reconcile:

```bash
node scripts/worktree-manager.js unlock --repo /path/to/repo \
  --branch <type>/<slug> --owner "<exact lock reason>" --terminal
node scripts/worktree-manager.js reconcile --repo /path/to/repo --apply
```

For a moved/renamed checkout, run `repair` explicitly. Preview old-layout
migration before applying it:

```bash
node scripts/worktree-manager.js repair --repo /new/repo/path --apply
node scripts/worktree-manager.js repair --repo /new/repo/path \
  --old-repo-name old-name --apply
node scripts/worktree-manager.js migrate --repo /path/to/repo --dry-run
node scripts/worktree-manager.js migrate --repo /path/to/repo --apply
```

## Workflow Selection

| Scenario                  | Commands                                                                          | Time              |
| ------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| Solo dev (fast iteration) | `/bs:dev` → code → `/bs:quality --merge`                                          | 30-60 min         |
| Team collaboration        | `/bs:dev` → code → `/bs:quality` → team reviews → `git checkout main && git pull` | Varies            |
| Production launch         | `/bs:dev` → code → `/bs:quality --level 98 --merge --deploy`                      | 1-3 hours         |
| Emergency hotfix          | `/bs:hotfix "description"`                                                        | 5-10 min          |
| Rapid iteration           | code → `/bs:quality --scope changed` (repeat) → `/bs:quality --merge`             | 2-5 min per chunk |

## Autonomous Mode

```bash
/bs:ralph                        # Work through 10 backlog items
/bs:ralph --until "4 hours"      # Time-boxed autonomous work
/bs:ralph --parallel             # Parallel with agent teams
```

## Strategy & Reflection

```bash
/bs:strategy "question"          # Multi-model advisory panel
/bs:status                       # Catch up after time away
```

## Maintenance

```bash
/bs:status                       # Catch up after time away
/bs:deps --audit                 # Check dependency health
/bs:sync --mode check            # Verify ~/.claude symlinks + hooks resolve
/bs:sota                         # Score the setup, self-heal
```

## Context Management

**Session Length Best Practices:**

- **Target: < 50 turns per session** — Break at natural boundaries
- **Warning signs:** Session slowing down, repeated questions, context compression messages
- **Break pattern:** `/bs:dev` → code → `/bs:quality` → `/clear` → next feature

**Commands:**

- `/compact` at milestones (after commits, before quality)
- `/clear` between features
- `claude --resume` to pick a previous session back up
- `/bs:recover-quality` to audit and repair after a crash or a bad run

**Why short sessions matter:** After ~50 turns, context compression kicks in repeatedly, losing detail and wasting tokens. A 545-turn session generates 380MB of transcript. Should be 5-10 focused chunks instead.

## Full Reference

Run `/bs:workflow` for the complete daily workflow guide with all flags and examples.
