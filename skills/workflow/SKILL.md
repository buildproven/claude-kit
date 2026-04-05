---
name: workflow
description: Daily development workflow reference for the public claude-power-kit command set. Use when the user asks how to work with the toolkit, what the normal flow is, or which command to run next.
---

# Workflow Skill

Use this skill to guide users through the public `claude-power-kit` workflow.

## Core loop

```bash
/bs:dev my-feature
# ... implement ...
/bs:test --watch
/bs:quality
```

Use `/bs:quality --merge` when the user wants the workflow to carry through merge as well.

## Typical routes

- Standard feature: `/bs:dev` -> code -> `/bs:test` -> `/bs:quality`
- Larger task: `/bs:plan` -> `/bs:dev` -> `/bs:quality`
- Backlog execution: `/bs:backlog` -> `/bs:ralph`
- Emergency fix: `/bs:hotfix`

For more detail, read `daily-steps.md`.
