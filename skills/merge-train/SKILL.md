---
name: merge-train
title: "Merge Train"
description: Parallel cross-repo quality+merge sweep. One Task agent per repo in an isolated worktree runs /bs:quality --merge, auto-merges if green, post-merge cleanup, consolidated summary. Honors the never-skip-pre-existing-broken-CI rule.
context: fork
---

# /bs:merge-train — Parallel Cross-Repo Merge Sweep

**Goal**: Turn the ad-hoc "check status, run quality, merge PRs across 5+ repos" sweep into a single command. Mornings become "what shipped overnight" instead of "what needs shipping today."

> **Scaling hint**: For sweeps across >5 repos, prefix your invocation with `ultracode` (or run `/effort ultracode`) to have Claude automatically plan a dynamic workflow — up to 16 concurrent workers, resumable if a repo stalls.

## Inputs

- `--repos a,b,c` — limit to named repos (default: all repos under `--repos-root`, or `$BS_MERGE_TRAIN_ROOTS` if set, with open PRs)
- `--repos-root a,b,c` — colon- or comma-separated project roots to scan for repos (default: `$BS_MERGE_TRAIN_ROOTS`, falling back to `~/Projects/{products,internal,personal}` if unset — that fallback is this overlay's own convention, not a kit requirement)
- `--dry-run` — status report only, no merges
- `--max-diff <N>` — auto-merge ceiling in changed lines (default 50). Larger PRs surface for manual review
- `--no-cleanup` — skip post-merge branch deletion
- `--max-quality-minutes <N>` — **total** wall-clock budget for the whole sweep's quality runs (default 45). Each `/bs:quality --merge` is individually bounded (~4–12 min), but a sweep across many PRs multiplies that; this caps the aggregate so one pathological campaign or a large fleet can't run the sweep unbounded. When the budget is exhausted, stop dispatching new PRs and report the remainder as "deferred (sweep budget)".
- `--linear-team <name>` — Linear team for residual tickets (default: `$BS_MERGE_TRAIN_LINEAR_TEAM` if set; otherwise residuals are logged to `data/merge-train-residuals.jsonl` only, no ticket is filed)

## Phase 1: Discovery (sequential, fast)

```bash
# Find candidate repos. Roots come from --repos-root, else
# $BS_MERGE_TRAIN_ROOTS (colon- or comma-separated), else this overlay's own
# default layout below — replace the fallback with whatever your project
# layout actually is.
IFS=':,' read -r -a roots <<< "${BS_MERGE_TRAIN_ROOTS:-$HOME/Projects/products:$HOME/Projects/internal:$HOME/Projects/personal}"
candidates=()
for root in "${roots[@]}"; do
  [ -d "$root" ] || continue
  for repo in "$root"/*; do
    [ -d "$repo/.git" ] || continue
    candidates+=("$repo")
  done
done
```

For each candidate, query `gh pr list --state open --json number,title,additions,deletions,headRefName,statusCheckRollup` and build a worklist:

```
repo                          | PR  | +/-     | head                       | CI
buildproven/claude-setup       | 352 | 30/12   | codex/fleet-improvements   | passing
buildproven/starknet           | 88  | 240/180 | feat/cron-budget-killswitch| pending
...
```

Skip repos with zero open PRs. Skip individual PRs in draft state.

## Phase 2: Parallel Workers (one per repo)

**Sweep budget (enforce before and during dispatch):** record a sweep start time. Before launching each new repo worker — and, for a worker processing multiple PRs, before each PR after the first — check elapsed wall-clock against `--max-quality-minutes` (default 45). Once the budget is exhausted, stop launching new quality runs; let in-flight workers finish, and collect every not-yet-started PR as **deferred (sweep budget)** in the Phase 3 summary (with a Linear ticket, same as manual-review). Emit a progress line as each campaign starts — `[merge-train] repo N/M (<name>), <elapsed>m/<budget>m elapsed` — so a long sweep is visibly "K bounded campaigns," not one opaque hang. This is the aggregate ceiling that each individually-bounded `/bs:quality` run cannot provide on its own.

For each repo with PRs to process, spawn a Task agent **with `isolation: "worktree"`** (per the parallel-agents rule in CLAUDE.md). Do **not** pin the worker's model: its whole job is to run `/bs:quality --merge`, and the quality review agents inherit the worker's session model — so pinning the worker to a cheaper model would silently run every review in the sweep on that cheaper model, which is exactly what quality's deliberate no-pin decision exists to prevent (weaker review, not a cost win on mechanical work). Let the worker inherit the operator's session model so reviews run at the intended tier. Each worker receives:

- The repo path
- The PR list to process for its repo
- The `--max-diff` threshold
- Instruction to invoke `/bs:quality --merge` per PR

Worker contract:

1. `cd` into the assigned repo
2. For each open PR (oldest first):
   - `gh pr checkout <num>` into the agent's isolated worktree
   - Verify no pre-existing broken CI (lint, tests). If broken, **fix as part of this PR's work** — do not defer (per workflow rule)
   - Run `/bs:quality --merge`
   - If diff > `--max-diff`, do NOT auto-merge; mark for manual review
   - If quality gate green AND diff ≤ threshold AND `Reviewed-By: quality` trailer present → merge
   - Post-merge: `git checkout main && git pull && git branch -d <branch>` (auto-checkout-main rule)
3. Return a per-repo summary

## Phase 3: Consolidation

Aggregate worker outputs into a single table:

```
Repo                          | Merged | Manual review | Failed | Cleaned branches
buildproven/claude-setup       | 1      | 0             | 0      | 1
buildproven/starknet           | 0      | 1             | 0      | 0
buildproven/retire-runway      | 2      | 0             | 0      | 2
TOTAL                          | 3      | 1             | 0      | 3
```

For each "Manual review" or "Failed" PR, if a `--linear-team`/`$BS_MERGE_TRAIN_LINEAR_TEAM` is configured, create a Linear ticket in that team with:

- PR URL
- Reason (oversized diff / quality gate failure / pre-existing broken CI)
- Worker log excerpt

## Hard Rules (do not violate)

- **Worktree isolation is mandatory** — every parallel worker uses `isolation: "worktree"`. The hook enforces this; a violation is a bug.
- **Never skip pre-existing broken CI** — fix it as part of the current PR or fail loudly.
- **Never merge without a provider-neutral `Reviewed-By: quality` trailer** — that's the quality-gate contract.
- **Never push directly to main** — every change goes through a PR.
- **Auto-checkout main after every successful merge** — never leave a worker stranded on a deleted branch.

## Failure Modes & Recovery

- **Quality gate fails** → leave PR open, log reason, surface in Linear, move on to next PR
- **Merge conflict** → leave PR open, surface in Linear with conflict note, do not attempt auto-resolution
- **Worker times out (>30 min)** → kill, mark PRs for that repo as "needs manual review", continue with other repos
- **Linear MCP unavailable** → log issues to `data/merge-train-residuals.jsonl` with timestamp; do not silently drop

## Output

A single consolidated message containing:

1. Headline: "Merged X / processed Y across Z repos in T minutes"
2. The table from Phase 3
3. Linear ticket IDs for residuals
4. A `next-actions` section listing manual-review PRs with reason

## Schedule (optional)

To run nightly, this is a headless-Claude-invocation problem, not something
the kit ships a scheduler for. The general shape: a wrapper script that
invokes `claude` headless (or your own Task/cron runner) with a prompt calling
this skill, on whatever schedule mechanism your OS/environment provides
(launchd on macOS, cron/systemd timers on Linux, a CI schedule trigger, etc).
If you already have other scheduled Claude jobs in this repo, follow the same
wrapper/scheduler pattern they use rather than inventing a new one.

For unattended runs, prefer a conservative `--max-diff 30`; raise during interactive use.
