---
name: bs:workflow
description: Quick reference for the public daily development workflow
argument-hint: "→ daily dev workflow reference"
tags: [workflow, guide, reference]
category: development
model: haiku
---

# Daily Development Workflow

Quick reference for the public `claude-kit` workflow.

## Core loop

```bash
/bs:dev my-feature
# ... make changes ...
/bs:test --watch
/bs:quality
```

Use `/bs:quality --merge` when you want the quality loop to carry through merge as well.

All linked worktrees use one lifecycle API and live outside the primary
repository:

```text
<primary-repo-parent>/.worktrees/<repo-name>/<branch-slug>
```

```bash
node scripts/worktree-manager.js create --repo /path/to/repo \
  --branch feature/my-feature --creator manual --purpose "my feature"
node scripts/worktree-manager.js status --repo /path/to/repo
node scripts/worktree-manager.js reconcile --repo /path/to/repo --apply
```

`reconcile --apply` is the recovery path after manual/admin merges. It retains
locked, dirty, unpushed, open-PR, recent, and inconclusive worktrees. Use
`migrate --dry-run` before adopting legacy layouts and `repair --apply` after
an explicitly reviewed repository move or rename.

If auto risk resolves to critical, approve exactly one PR revision with:

```bash
/bs:quality approve --pr 14 --head <exact-40-character-sha>
```

Approval is signed and expiring. A genuine new commit invalidates it; a
rebase onto a newer base with no content change (patch-id identical) does
not — that resumes without a fresh review cycle.

Check an in-flight or stalled campaign's state on demand (gates, provider
review, break-glass, CI) without waiting for a failure:

```bash
/bs:quality status --manifest <exact-manifest-path>
```

When invoking from a forked agent context (e.g. a parallel agent whose `cwd` is a harness scratch directory rather than the worktree), pass `--target-dir <path>`:

```bash
/bs:quality --merge --target-dir /path/to/repo
```

This is the canonical pattern for parallel agent fan-outs — without it, the quality skill operates on the wrong directory and the gate fails with no useful output.

## Common paths

### Standard feature work

```bash
/bs:dev my-feature
/bs:test --watch
/bs:quality
```

### Larger ambiguous task

```bash
/bs:prd my-feature
/bs:dev implementation-step
/bs:quality
```

The PRD decomposes work into independently verifiable vertical slices with
explicit blocking edges. Wide mechanical refactors use expand → migrate →
contract so the branch stays green.

### Bug diagnosis

```bash
/bs:dev login-timeout --fix
# diagnosing-bugs establishes one red-capable reproduction command first
/bs:quality
```

### UI work

```bash
# frontend-design routes product vs marketing vs redesign
# ui-reviewer renders/reviews toward the strict 99/100 threshold
/bs:quality --level 98
```

### Autonomous backlog work

```bash
/bs:backlog
/bs:ralph
```

### Emergency fix

```bash
/bs:hotfix payment-timeout
```

## What runs automatically

- Git hooks for branch safety and code quality
- Post-edit linting hooks
- Stop validation hooks
- CI quality gates on pull requests

## Command quick reference

| Command       | Use For                         |
| ------------- | ------------------------------- |
| `/bs:dev`     | Start feature work              |
| `/bs:test`    | Tight test feedback loop        |
| `/bs:quality` | Quality gate before PR or merge |
| `/bs:plan`    | Lightweight multi-repo planning |
| `/bs:prd`     | Strict PRD + vertical slices    |
| `/bs:ralph`   | Autonomous backlog execution    |
| `/bs:backlog` | Prioritization                  |
| `/bs:help`    | Full command lookup             |

## Notes

- This public workflow stops at a clean PR and merge path.
- Deployment, posting, product operations, and internal service workflows are intentionally out of scope for `claude-kit`.
