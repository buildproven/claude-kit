---
name: recover
description: Crash and state recovery skill. Auto-invokes when Claude Code crashes, loses context, encounters broken state, won't start, hangs, freezes, hits stale locks, or has incomplete git operations. Guides through diagnosis, recovery, and context restoration.
---

# Recovery Skill

Systematic recovery from crashes, broken state, and lost context.

## Live State (auto-injected)

- Git status: !`git status --short 2>/dev/null || echo "not a git repo"`
- Git locks: !`ls -la .git/*.lock 2>/dev/null || echo "no locks"`
- Incomplete ops: !`ls .git/rebase-merge .git/rebase-apply .git/MERGE_HEAD 2>/dev/null || echo "none"`
- Branch: !`git branch --show-current 2>/dev/null || echo "unknown"`

## When This Activates

- Claude Code crashed or won't start
- Lost context mid-task
- Broken or inconsistent state
- Hung or frozen process
- Stale lock files
- Incomplete git operations (rebase, merge, cherry-pick)

## Immediate Diagnostics

The live state above covers the basics. Run these for deeper assessment:

```bash
# Check for stale git locks
ls -la .git/*.lock 2>/dev/null

# Check for incomplete git operations
git status
ls .git/rebase-merge .git/rebase-apply .git/MERGE_HEAD 2>/dev/null

# Check for orphaned processes
ps aux | grep -E '(claude|node|esbuild|next|vite)' | grep -v grep

# Check system resources
vm_stat | head -5        # Memory pressure (macOS)
sysctl vm.swapusage      # Swap usage (macOS)
df -h .                  # Disk space
```

## Recovery Procedures

### 1. Git Lock Cleanup

```bash
# Remove stale lock (only if no git process running)
rm -f .git/index.lock
rm -f .git/shallow.lock
rm -f .git/config.lock
```

### 2. Abort Incomplete Git Operations

```bash
# Incomplete rebase
git rebase --abort

# Incomplete merge
git merge --abort

# Incomplete cherry-pick
git cherry-pick --abort

# Reset to known good state (check stash first)
git stash list
git log --oneline -5
```

### 3. Kill Orphaned Processes

Use `/bs:cleanup` for comprehensive cleanup, or manually:

```bash
# Kill specific process types
pkill -f "next dev"
pkill -f "vite"
pkill -f "esbuild"

# Nuclear option (all node)
pkill -f node
```

### 4. Restore Context

```bash
# Check Ralph state (if running autonomous)
ls .claude/*ralph*state*.json 2>/dev/null | head -5

# Recent git activity
git log --oneline -10
git stash list
git branch -v

# Check for session data
ls -la .claude/session-*.json 2>/dev/null

# Resume previous session
# Use /bs:resume to restore context
```

## Context Restoration Checklist

1. What branch am I on? (`git branch --show-current`)
2. Are there uncommitted changes? (`git status`)
3. Was Ralph running? (check `.claude/*ralph*state*.json`)
4. What was the last backlog item? (check Linear: https://linear.app/buildproven)
5. Any stashed work? (`git stash list`)

## When to Escalate

These require manual investigation — don't attempt automated fixes:

- **Corrupted git objects**: `git fsck` shows errors → re-clone may be needed
- **Filesystem corruption**: repeated I/O errors → check disk health
- **Persistent OOM kills**: system can't sustain workload → close other apps or increase resources
- **Broken node_modules**: `rm -rf node_modules && npm install` (confirm with user first)
