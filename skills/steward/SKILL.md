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
- `audit` checks convergence state only: default-branch drift, dirty files,
  open PRs, unmerged branches, stashes, and extra or locked worktrees. The
  creator workflow's quality run owns source validation;
- `fix` asks the lifecycle manager to remove only proven terminal residue, then
  re-audits. It preserves any remaining lifecycle state. It creates a repair
  worktree only when instruction synchronization is the sole remaining defect,
  and requires the repository's quality merge workflow.

## Lifecycle ownership

The command, skill, or agent that creates a branch, worktree, lock, lease, or
temporary artifact owns its normal terminal cleanup. Quality owns its merge
cleanup tail. Dev and Ralph must release their exact lock at terminal handoff.
Steward is the fallback reconciler for residue after the creator is no longer
active; it never takes over a live exact-owner lock or discards an ambiguous
stash, dirty checkout, or unpushed branch.

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
- Never run repository test/build suites during convergence audit; protected
  delivery already owns those gates.
- Never push a default branch.
- Keep one concern per repair branch.
- Surface provider quota, authentication, and timeout failures as their real type.
- Report discovered repositories, convergence failures, repair PRs, and the state
  evidence path.
