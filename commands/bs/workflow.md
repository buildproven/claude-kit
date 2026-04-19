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

## Common paths

### Standard feature work

```bash
/bs:dev my-feature
/bs:test --watch
/bs:quality
```

### Larger ambiguous task

```bash
/bs:plan
/bs:dev implementation-step
/bs:quality
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
| `/bs:plan`    | Structure bigger work           |
| `/bs:ralph`   | Autonomous backlog execution    |
| `/bs:backlog` | Prioritization                  |
| `/bs:help`    | Full command lookup             |

## Notes

- This public workflow stops at a clean PR and merge path.
- Deployment, posting, product operations, and internal service workflows are intentionally out of scope for `claude-kit`.
