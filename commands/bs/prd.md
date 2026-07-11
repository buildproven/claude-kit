---
name: bs:prd
description: PRD discipline — 3-5 clarifying questions before draft, junior-dev-targeted PRD, dot-notation task list (0.0 = create feature branch), machine-verifiable acceptance criteria, mandatory pause gates between parent tasks and subtask expansion. The forcing function for any work that takes more than one day.
argument-hint: "<feature-name> | from <notes> | review <path> | tasks <path>"
category: planning
tags: [planning, spec, prd, workflow]
---

Invoke the `prd` skill with all provided arguments.

**Modes:**

- `/bs:prd <feature-name>` — start a new PRD interactively
- `/bs:prd from <voice-recording-or-rough-notes>` — turn rough notes into a structured PRD
- `/bs:prd review <path>` — re-run validation on an existing PRD
- `/bs:prd tasks <path>` — generate dot-notation task list from an existing PRD
