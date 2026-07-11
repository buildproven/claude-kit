---
name: bs:triage
description: Pull Sentry errors → cluster → file Linear tickets → optionally open fix-PR in a worktree. Plus synthetic user-journey orchestration.
argument-hint: "[(default report)] [--fix <issue-id>] [--file-tickets] [synthetic init|run]"
category: operations
tags: [observability, sentry, triage, synthetic, monitoring]
---

Invoke the `triage` skill with all provided arguments.

**Modes:**

- `/bs:triage` — default error report (top clusters, last 24h)
- `/bs:triage --fix <sentry-issue-id>` — generate a fix PR for a specific error
- `/bs:triage --file-tickets` — batch-create Linear tickets for all untracked errors
- `/bs:triage synthetic init` — set up synthetic journey tests for a product
- `/bs:triage synthetic run` — run synthetic journeys and report results
