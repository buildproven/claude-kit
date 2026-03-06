---
name: bs:status
description: Project catch-up summary after time away
argument-hint: '→ recent activity + next steps'
tags: [project, status, catch-up]
category: project
model: haiku
---

# /bs:status - Project Catch-Up

**Quick orientation when returning to a project after time away**

Shows one-screen summary of: recent commits, open PRs, CI status, dependency health, and suggested next steps.

## Quick Reference

```bash
/bs:status              # Full project summary
/bs:status --recent 3d  # Last 3 days only
```

## What It Shows

### Recent Activity (Last 7 Days)

- Recent commits with authors
- Merged PRs
- Open PRs awaiting review

### Health Checks

- CI status (passing/failing)
- Outdated dependencies
- Open issues assigned to you

### Next Steps

- Actionable items based on project state
- Failing CI? → Link to logs
- Outdated deps? → `/bs:deps --upgrade`
- Open PRs? → `/bs:quality --merge`

## Example Output

```
📊 Project Status: claude-setup
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## Recent Activity (Last 7 Days)

### Commits
  ✅ 7b00891 feat: enhanced /bs:resume (2 days ago) - Author
  ✅ 4354342 feat: cost tracking (2 days ago) - Author
  ✅ f1e7a1a docs: sync improvements (3 days ago) - Author

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

## Use Cases

- **Monday morning**: "What happened while I was away?"
- **Context switching**: Quick re-orient after working on other projects
- **Onboarding**: New team member catching up

## Value

- Reduces friction when returning to project
- No mental overhead remembering project state
- Actionable next steps (not just status)

---

## See Also

- `/bs:dev` - Start development work
- `/bs:quality` - Quality loop
- `/bs:backlog` - View/manage backlog
