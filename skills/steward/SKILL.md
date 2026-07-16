---
name: steward
description: Discover recently active repositories, audit convergence, and optionally repair findings through a provider-neutral PR workflow
---

# Fleet steward

Maintain a small, active repository fleet without hardcoding either Claude Code or
Codex. The orchestrator discovers repositories from GitHub activity, maps them to
local checkouts, runs read-only checks, and stores evidence outside every repo.

## Usage

```bash
/bs:steward status
/bs:steward audit
/bs:steward fix --provider codex --fallback claude
```

Defaults:

- active means at least two commits in 14 days with one non-bot commit, or an open
  non-draft pull request;
- at most 10 locally available repositories are audited;
- `audit` is read-only apart from fetch/prune and external state evidence;
- `fix` refuses dirty or locally-ahead repositories, creates a worktree and feature
  branch, and requires the repository's quality merge workflow.

## Execution

Locate the installed kit from the current skill path, then run:

```bash
bash "<kit-root>/scripts/steward/orchestrate.sh" <arguments>
```

Supported arguments:

```text
status | audit | fix
--config <path>
--max-repos <positive integer>
--provider auto|codex|claude
--fallback none|codex|claude
```

The default config is
`${XDG_CONFIG_HOME:-~/.config}/buildproven/fleet.json`. If it does not exist, copy
`<kit-root>/config/fleet.example.json`, set the GitHub owners and local roots, and
rerun. Never invent owners or repair repositories that were not selected by the
manifest.

## Safety and reporting

- Never edit a primary checkout.
- Never repair ambiguous local work.
- Never push a default branch.
- Keep one concern per repair branch.
- Surface provider quota, authentication, and timeout failures as their real type.
- Report discovered repositories, convergence failures, repair PRs, and the state
  evidence path.
