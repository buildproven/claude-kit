---
name: merge-train
title: "Merge Train"
description: Parallel cross-repo quality+merge sweep. One Task agent per repo in an isolated worktree runs /bs:quality --merge, auto-merges if green, post-merge cleanup, consolidated summary. Honors the never-skip-pre-existing-broken-CI rule.
---

# /bs:merge-train — Parallel Cross-Repo Merge Sweep

**Goal**: Turn the ad-hoc "check status, run quality, merge PRs across 5+ repos" sweep into a single command. Mornings become "what shipped overnight" instead of "what needs shipping today."

> **Scaling hint**: Keep the sweep deliberately small (at most 4 concurrent workers) until the operator has a cross-repo concurrency and usage budget. Resume a deferred batch in a fresh session rather than growing one long-lived parent context.

Before dispatch, acquire one `merge-train` admission through
`scripts/autonomous-loop-runtime.js`, passing `--owner-pid "$$"` from its
long-lived Bash launcher. The operator-scoped gate allows at most two
autonomous loops across repositories and rejects a start when the configured
Claude 5h or 7d utilization reaches its threshold. Each worker must be a fresh,
non-persistent process with an explicit repo/PR/manifest handoff; do not fork or
resume the train's transcript into a worker.

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

For each candidate, query `gh pr list --state open --json number,title,additions,deletions,headRefName,headRefOid,baseRefName,baseRefOid,statusCheckRollup` and build a worklist. Persist the discovered `headRefOid` and `baseRefOid` with each row; they are an observation only, never review evidence.

```
repo                          | PR  | +/-     | head                       | CI
buildproven/claude-setup       | 352 | 30/12   | codex/fleet-improvements   | passing
buildproven/starknet           | 88  | 240/180 | feat/cron-budget-killswitch| pending
...
```

Skip repos with zero open PRs. Skip individual PRs in draft state.

## Phase 2: Parallel Workers (one per repo)

**Sweep budget (enforce before and during dispatch):** set these four values once in the sweep controller, then pass/export the same values to every worker. `TRAIN_STATE_FILE` must be a single shared path accessible to every worker in this sweep; do not let workers invent their own path. Before each worker starts `/bs:quality`, claim the planned `reservedSeconds` under that shared state file; planning alone is not admission.

```bash
TRAIN_STARTED_EPOCH="$(date +%s)"
TRAIN_BUDGET_SECONDS="$(( max_quality_minutes * 60 ))" # `max_quality_minutes` is the parsed --max-quality-minutes argument
TRAIN_DEADLINE_EPOCH="$(( TRAIN_STARTED_EPOCH + TRAIN_BUDGET_SECONDS ))"
TRAIN_STATE_FILE="${BS_MERGE_TRAIN_STATE_FILE:?set one shared state-file path before dispatch}"
```

The claim is atomic across workers:

```bash
ADMISSION="$(node scripts/merge-train-batch.js admit \
  --state-file "$TRAIN_STATE_FILE" \
  --deadline-epoch "$TRAIN_DEADLINE_EPOCH" \
  --budget-seconds "$TRAIN_BUDGET_SECONDS" \
  --reservation-id "$REPOSITORY#$PR_NUMBER" \
  --reserved-seconds "$PLANNED_RESERVED_SECONDS")" || {
  # Exit 2 means deferred: shared deadline or reservation budget is exhausted.
  echo "deferred (sweep budget)"
  continue
}
export BS_QUALITY_SHARED_DEADLINE_EPOCH="$(printf '%s' "$ADMISSION" | jq -er '.environment.BS_QUALITY_SHARED_DEADLINE_EPOCH')"
export BS_QUALITY_TRAIN_RESERVATION_SECONDS="$(printf '%s' "$ADMISSION" | jq -er '.environment.BS_QUALITY_TRAIN_RESERVATION_SECONDS')"
export BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS="$(printf '%s' "$ADMISSION" | jq -er '.environment.BS_QUALITY_MAX_TOTAL_PROVIDER_SECONDS')"
```

The quality governor records the common deadline and caps cumulative provider execution at this reservation. It refuses a provider pass that has not begun by the deadline, but never interrupts an already admitted pass; that preserves the policy that budgets limit planned scope rather than guillotining useful review. Stop dispatching after a failed admission and collect all not-yet-started PRs as **deferred (sweep budget)** in the Phase 3 summary (with a Linear ticket, same as manual-review). Emit a progress line as each campaign starts — `[merge-train] repo N/M (<name>), <elapsed>m/<budget>m elapsed` — so a long sweep is visibly "K bounded campaigns," not one opaque hang.

**Freshness reconciliation (mandatory before expensive work):** a worker must fetch both the current PR head and its current base, then re-read `headRefOid` and `baseRefOid` with `gh pr view`. Compare that current snapshot with discovery through `merge-train-batch.js` **before** it runs local gates or a provider panel. If either SHA changed, discard any prior review evidence and create a new quality campaign for the new exact head/base pair. If the PR is behind its base, use the repository's approved update-branch/rebase path, re-fetch, and re-read the PR snapshot before continuing; a conflict is a visible `deferred (base reconciliation conflict)` result, not a reason to run gates against a stale branch. Do not auto-push a local rebase.

**Panel admission (mandatory before provider launch):** pass the current tier, full panel size, planned review seconds, and shared remaining budget to `merge-train-batch.js`. A critical panel that cannot complete its full planned review is deferred with `critical-panel-cannot-finish-within-batch-budget`; never start it merely to time out. If a non-critical full Claude panel does not fit but a two-agent floor does, set `BS_QUALITY_PANEL_AGENTS` to the planned subset before `/bs:quality --merge`. The invocation records the selected/full counts and `incomplete: true` in its manifest, review record, and artifact inventory; it cannot satisfy exact-head merge authorization until a full required review succeeds.

For each repo with PRs to process, spawn a Task agent **with `isolation: "worktree"`** (per the parallel-agents rule in CLAUDE.md). The quality runner pins its Claude review subprocesses to the configured non-1M review model, so worker-session model choice does not silently multiply panel cost. Each worker receives:

- The repo path
- The PR list to process for its repo
- The `--max-diff` threshold
- Instruction to invoke `/bs:quality --merge` per PR

Worker contract:

1. `cd` into the assigned repo
2. For each open PR (oldest first):
   - Fetch the PR head and base, reconcile the PR with its base, and capture the current `headRefOid`/`baseRefOid` before running any gate. Feed the discovery/current snapshots plus the shared batch clock to `scripts/merge-train-batch.js`.
   - `gh pr checkout <num>` into the agent's isolated worktree only after that reconciliation succeeds.
   - Verify no pre-existing broken CI (lint, tests). If broken, **fix as part of this PR's work** — do not defer (per workflow rule)
   - Run `/bs:quality --merge` with the exact reconciled PR target and the panel plan. Treat its exit status as the merge outcome. Never invoke `gh pr merge` directly: quality owns identity validation, review coverage, CI, authorization, and merge.
   - If diff > `--max-diff`, do NOT auto-merge; mark for manual review
   - If the diff is over `--max-diff`, do NOT start a merge campaign; mark for manual review.
   - Post-merge: invoke `quality-merge-cleanup.sh` through the quality campaign, then reconcile the assigned worktree with `worktree-manager.js`. Never `git checkout main` from the worker: the primary checkout already owns that branch.
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
- **Never invoke `gh pr merge` from a worker** — `/bs:quality --merge` is the only merge authority.
- **Never push directly to main** — every change goes through a PR.
- **Reconcile worktrees after every successful merge** — quality cleanup owns the primary checkout; workers never check out its branch.
- **Never reuse stale review evidence** — a changed PR head or base starts a new exact-head campaign, including after a base reconciliation.
- **Never hide a reduced panel** — a budget-reduced review is marked incomplete and cannot be represented as full merge evidence.

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
