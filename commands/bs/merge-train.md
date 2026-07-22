---
name: bs:merge-train
description: Parallel cross-repo quality+merge sweep — one worker per repo in isolated worktrees, consolidated summary
category: quality
tags: [quality, multi-repo, parallel, automation]
---

Invoke the `merge-train` skill with all provided arguments.

**Usage**:

```
/bs:merge-train                       # All configured repos with open PRs
/bs:merge-train --repos a,b,c         # Limit to named repos
/bs:merge-train --repos-root a:b:c    # Project roots to scan (default: $BS_MERGE_TRAIN_ROOTS)
/bs:merge-train --dry-run             # Status report only, no merges
/bs:merge-train --max-diff 50         # Auto-merge cap (lines); larger PRs surface for review
/bs:merge-train --no-cleanup          # Skip post-merge branch deletion
/bs:merge-train --linear-team NAME    # Linear team for residual tickets (default: $BS_MERGE_TRAIN_LINEAR_TEAM)
```

**What it does**:

1. Discovers open PRs across configured repos in parallel (one Task agent per repo, isolated worktree)
2. Each worker runs `/bs:quality --merge` (lint, tests, agent reviews, Codex stamp)
3. Delegates each eligible merge exclusively to `/bs:quality --merge`; flags larger diffs for manual review
4. Reconciles the assigned worktree after quality-owned merge cleanup
5. Surfaces residual issues as Linear tickets, if a Linear team is configured (otherwise logs to `data/merge-train-residuals.jsonl`)
6. Returns a single consolidated table: repos touched, PRs merged, branches cleaned, residual issues

**Guarantees**:

- Never skips pre-existing broken CI (per workflow rule)
- Worktree isolation prevents the parallel-session conflicts that have bitten this fleet before
- Workers never invoke `gh pr merge` or check out the primary branch directly
