---
name: bs:status
description: Project catch-up summary after time away
argument-hint: "→ recent activity + next steps"
tags: [project, status, catch-up]
category: project
model: haiku
---

# /bs:status - Project Catch-Up

```bash
/bs:status              # Full project summary (recent commits, PRs, CI, deps, next steps)
/bs:status --recent 3d  # Last 3 days only
```

## Example Output

```
📊 Project Status: claude-kit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Recent Activity (Last 7 Days)

### Commits
  ✅ 7b00891 feat: enhanced /bs:resume (2 days ago) - you
  ✅ 4354342 feat: cost tracking (2 days ago) - you
  ✅ f1e7a1a docs: sync improvements (3 days ago) - you

### Pull Requests
  🟢 #33 OPEN: Search CLAUDE.md patterns (ready to merge)
  ✅ #32 MERGED: Enhanced /bs:resume
  ✅ #31 MERGED: Cost tracking

## Health Status

  ✅ CI: All checks passing
  ⚠️  Dependencies: 3 outdated (non-critical)
  ✅ Issues: No blockers

## Next Steps

  1. Merge PR #33: /bs:quality --merge
  2. Update dependencies: /bs:deps --upgrade
  3. Start next feature: /bs:dev

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
