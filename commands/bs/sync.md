---
name: bs:sync
description: 'Check/repair Claude config symlinks (claude-kit → ~/.claude)'
argument-hint: '/bs:sync --mode check → verify symlinks | repair → fix broken | all → full resync'
category: maintenance
model: haiku
---

# /sync: Claude Setup Synchronization

**Usage**: `/bs:sync [--mode check|repair|all]`

Manages Claude Code configuration symlinks and setup consistency.

## Paths

```
SETUP_REPO=$SETUP_REPO
```

## Modes

### Check (default)

```bash
$SETUP_REPO/scripts/setup-claude-sync.sh --check
```

Validates all symlinks and configuration:

- `~/.claude/settings.json` → `claude-kit/config/settings.json`
- `~/.claude/commands/` → `claude-kit/commands/`
- CLAUDE.md files in expected locations

### Repair

```bash
$SETUP_REPO/scripts/setup-claude-sync.sh --repair
```

Fixes broken symlinks and missing configs.

### All

Complete sync: backup → git commit → push → test everything.

---

## Quick Reference

```bash
# Health check
/bs:sync --mode check

# Fix issues
/bs:sync --mode repair

# Full sync
/bs:sync --mode all
```

## New Computer Setup

```bash
git clone [repo] $SETUP_REPO
cd $SETUP_REPO
./scripts/setup-claude-sync.sh
```
