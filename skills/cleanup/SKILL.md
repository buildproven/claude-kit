---
name: cleanup
description: System resource cleanup skill. Auto-invokes on slow system, out of memory, disk space issues, zombie processes, high swap usage, or resource exhaustion. Provides quick diagnostics and delegates to /bs:cleanup for actions.
---

# Cleanup Skill

Quick diagnostics and resource recovery. Delegates to `/bs:cleanup` for cleanup actions.

## Live System State (auto-injected)

- Disk: !`df -h . ~ 2>/dev/null | tail -2`
- Memory pressure: !`memory_pressure 2>/dev/null | head -1 || echo "unavailable"`
- Node processes: !`pgrep -c node 2>/dev/null || echo "0"` running
- Claude processes: !`pgrep -c claude 2>/dev/null || echo "0"` running

## When This Activates

- System running slow
- Out of memory warnings
- Low disk space
- Zombie or orphaned processes
- High swap usage
- Resource exhaustion during builds

## Quick Diagnostic

The live state above covers initial triage. Run these for deeper investigation:

```bash
# Memory and swap (macOS)
memory_pressure               # Overall memory status
sysctl vm.swapusage           # Swap usage

# Disk space
df -h . ~                     # Current dir + home

# Process count and zombies
ps aux | wc -l                # Total processes
ps aux | awk '$8 ~ /Z/ {print}' | wc -l  # Zombie count

# Top memory consumers
ps aux -m | head -10

# Node/dev server processes
ps aux | grep -E '(node|next|vite|esbuild|webpack)' | grep -v grep
```

## Cleanup Actions

Use `/bs:cleanup` with the appropriate flag:

| Symptom            | Command                   | What it does                               |
| ------------------ | ------------------------- | ------------------------------------------ |
| Slow system        | `/bs:cleanup`             | Full cleanup (caches + processes + temp)   |
| Too many processes | `/bs:cleanup --processes` | Kill orphaned dev servers and node         |
| Low disk space     | `/bs:cleanup --caches`    | Clear npm, Homebrew, and AI CLI caches     |
| Need everything    | `/bs:cleanup --all`       | Full cleanup including node_modules caches |

## Prevention Tips

- **Kill dev servers after testing** — `next dev`, `vite`, etc. accumulate if left running
- **Use timeouts on long operations** — prevents hung processes from consuming resources
- **Run `/bs:cleanup` at end of long sessions** — especially after long autonomous runs
- **Watch swap usage** — if swap > 8GB, close unused apps before continuing heavy work
- **Clear node_modules periodically** — stale installs from branch switches waste disk
