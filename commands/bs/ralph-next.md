---
name: bs:ralph-next
description: 'Graph-orchestrated autonomous backlog execution with reflection, evidence logging, and compatibility with /bs:quality --merge'
argument-hint: '[--until "10 items"] [--scope all|feature|bug|effort:S|effort:M] [--section all|high|medium|low] [--quality auto|95|98] [--next|--classic] [--reflect-depth standard|deep] [--speculate auto|always|never] [--score-threshold 0.7] [--evidence-dir .claude/ralph-next] [--max-retries 3] [--max-ci-retries 2] [--no-compact] [--dry-run]'
tags: [workflow, autonomous, backlog, graph, evaluation]
category: development
model: sonnet
---

# /bs:ralph-next - Graph-Orchestrated Backlog Loop

**Usage**: `/bs:ralph-next [--until "N items"] [--scope all|feature|bug|effort:S|effort:M] [--section all|high|medium|low] [--quality auto|95|98] [--next|--classic] [--reflect-depth standard|deep] [--speculate auto|always|never] [--score-threshold 0.7] [--evidence-dir .claude/ralph-next] [--max-retries N] [--max-ci-retries M] [--no-compact] [--dry-run]`

**Defaults**: 10 items, all scopes, all sections, auto quality, next mode enabled, standard reflect depth, speculate auto, score threshold 0.7

`/bs:ralph-next` keeps the proven Ralph workflow but replaces blind retry loops with a graph state machine:
`PICK -> IMPLEMENT -> QUALITY -> REFLECT -> DECIDE`.

**Arguments received:** $ARGUMENTS

## Execution

**YOU are the orchestrator.** The shell script provides utilities for quality checks, state tracking, and backlog updates. YOU drive the PICK→IMPLEMENT→QUALITY→REFLECT→DECIDE loop.

```bash
SETUP_REPO="${SETUP_REPO:-$HOME/Projects/claude-setup}"
SCRIPT="$SETUP_REPO/scripts/ralph-next-run.sh"
EVIDENCE_DIR=".claude/ralph-next"
```

## Flags

| Flag                | Default                | Description                                                                                         |
| ------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `--until`           | **"10 items"**         | Stop condition: `"N items"`, `"N hours"`, `"checkpoint:name"`, `"item:SN-123"`, `"empty"`           |
| `--scope`           | **all**                | Filter by type: `all`, `feature`, `bug`, `effort:S`, `effort:M`                                     |
| `--section`         | **all**                | Filter by backlog section: `all`, `high`, `medium`, `low`                                           |
| `--quality`         | **auto**               | Quality level passed to `/bs:quality --merge --level`                                               |
| `--next`            | **enabled**            | Use graph loop mode (default for this command)                                                      |
| `--classic`         | **disabled**           | Compatibility fallback: delegate to `/bs:ralph-dev` with equivalent filters                         |
| `--reflect-depth`   | **standard**           | `standard` = classify + score, `deep` = include extra root-cause search before decide               |
| `--speculate`       | **auto**               | `auto` triggers on effort:M+ or retry>=2, `always` enables every routed speculate, `never` disables |
| `--score-threshold` | **0.7**                | Minimum trajectory score to label PASS when quality passes                                          |
| `--evidence-dir`    | **.claude/ralph-next** | Base path for next-mode state/evidence logs                                                         |
| `--max-retries`     | **3**                  | Generic retry cap (also bounded by failure-class budgets)                                           |
| `--max-ci-retries`  | **2**                  | CI recovery attempts after PR creation                                                              |
| `--no-compact`      | **disabled**           | Skip `/compact` between items (faster for short sessions where context pressure is not a concern)   |
| `--dry-run`         | **disabled**           | Show selected items and routing plan without execution                                              |

## State Graph

```text
INIT -> PICK -> IMPLEMENT -> QUALITY -> REFLECT -> DECIDE
  ^       |                                        |
  |       +-------------------------------> END    |
  |                                                |
  +---- PICK <- BLOCK <- DECIDE -> SPLIT -> PICK <-+
                           |
                           +-> SPECULATE -> QUALITY
```

**Loop guard:** hard cap of **8 state transitions per item**. If exceeded, route item to `BLOCK`.

## State Responsibilities

| State       | Action                                                                                          | Exit                                               |
| ----------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `INIT`      | Parse args, initialize state/evidence files, enforce git hygiene, preload learnings index       | `PICK`                                             |
| `PICK`      | Select highest-score unblocked, non-split-parent item matching filters                          | `IMPLEMENT` or `END`                               |
| `IMPLEMENT` | Create branch, spawn implementation agent, apply targeted context from prior failures/learnings | `QUALITY`                                          |
| `QUALITY`   | Run `/bs:quality --merge --level <quality>` and collect CI/merge status                         | `REFLECT` or `DECIDE` (`QUALITY_INFRA_FAIL`)       |
| `REFLECT`   | Classify failure type, compute trajectory score, write evidence files, summarize root cause     | `DECIDE`                                           |
| `DECIDE`    | Apply hard quality gate + retry matrix + budgets to choose next route                           | `PICK`, `IMPLEMENT`, `SPLIT`, `SPECULATE`, `BLOCK` |
| `SPLIT`     | Create child backlog items and mark source item as `split-parent`                               | `PICK`                                             |
| `SPECULATE` | Run 2 isolated worktree strategies; first passing branch wins, loser archived                   | `QUALITY` or `BLOCK`                               |
| `BLOCK`     | Quarantine item (`status=blocked`), create recovery branch + issue, continue session            | `PICK`                                             |
| `END`       | Promote learnings, sync index, write final session stats                                        | terminal                                           |

## Trajectory Evaluation

### Stage A - Hard Quality Gate

If `/bs:quality` fails, the item cannot be PASS or MARGINAL. Score is still logged for diagnostics, but routing is based on failure type.

### Stage B - Score Banding (only after Stage A pass)

```text
score = (quality_coverage * 0.4) + (first_attempt * 0.2) + (duration_ratio * 0.2) + (learning_value * 0.2)
```

| Component          | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| `quality_coverage` | `passed_checks / applicable_checks` (handles N/A checks) |
| `first_attempt`    | `1.0 / (1 + retries)`                                    |
| `duration_ratio`   | `clamp(estimated_minutes / actual_minutes, 0, 1)`        |
| `learning_value`   | 0.2 base + 0.4 patterns + 0.4 gotchas                    |

**Thresholds:**

- `>= score-threshold` => PASS
- `0.4-0.69` => MARGINAL (passes, but warn)
- `<0.4` => FAIL routing via `DECIDE`
- Effort `L` items may use 0.6 warning threshold for MARGINAL

## Failure-Class Retry Matrix

| Failure Type             | 1st                      | 2nd                           | 3rd                | Budget |
| ------------------------ | ------------------------ | ----------------------------- | ------------------ | ------ |
| `lint`                   | Retry auto-fix           | Retry targeted fix            | Block              | 2      |
| `typecheck`              | Retry targeted fix       | Retry broader refactor        | Block              | 2      |
| `import`                 | Retry export/path fix    | Retry config alias fix        | Block              | 2      |
| `test`                   | Retry targeted test+impl | Split into subtasks           | Speculate -> Block | 3      |
| `build:code`             | Retry code fix           | Split module                  | Block              | 2      |
| `build:config`           | Retry config fix         | Escalate backlog item         | -                  | 1      |
| `security:critical-high` | Escalate immediately     | -                             | -                  | 0      |
| `security:moderate-low`  | Retry guided fix         | Escalate backlog item         | -                  | 1      |
| `flaky-test`             | Rerun + stabilize        | Quarantine + annotate         | Block              | 1      |
| `env/tooling`            | Cache clear + reinstall  | Fresh bootstrap retry         | Block              | 2      |
| `oom/resource`           | Reduce concurrency retry | Split scope                   | Block              | 2      |
| `timeout`                | Split scope              | Speculate simplified approach | Block              | 2      |
| `merge-conflict`         | Rebase + resolve         | Escalate manual conflict      | -                  | 1      |

## Backward Compatibility Contract

`/bs:ralph-next` MUST preserve these invariants:

1. Exact quality invocation shape remains `/bs:quality --merge --level [auto|95|98]`.
2. Exactly one quality invocation per attempt.
3. No concurrent quality invocation on the same branch/worktree.
4. `--classic` never writes `.claude/ralph-next/*`.
5. `--next` never mutates `.claude/ralph-dev-state.json`.
6. Quality output differences between classic and next are metadata-only (timestamps/evidence).

## Implementation

### Step 0: Parse Arguments and Bootstrap

Parse `$ARGUMENTS` and extract:

```
UNTIL_CONDITION  (default: "10 items")
SCOPE_FILTER     (default: "all")
SECTION_FILTER   (default: "all")
QUALITY_LEVEL    (default: "auto")
REFLECT_DEPTH    (default: "standard")
SPECULATE_MODE   (default: "auto")
SCORE_THRESHOLD  (default: "0.7")
MAX_RETRIES      (default: 3)
MAX_CI_RETRIES   (default: 2)
DRY_RUN          (default: false)
EVIDENCE_DIR     (default: ".claude/ralph-next")
MODE             (default: "next"; "--classic" sets "classic")
```

**Classic mode**: If `--classic`, delegate to `/bs:ralph-dev` with equivalent flags and stop.

Initialize state and get candidate items:

```bash
bash "$SCRIPT" init \
  --evidence-dir "$EVIDENCE_DIR" \
  --until "$UNTIL_CONDITION" --scope "$SCOPE_FILTER" \
  --section "$SECTION_FILTER" --quality "$QUALITY_LEVEL" \
  --reflect-depth "$REFLECT_DEPTH" --speculate "$SPECULATE_MODE" \
  --score-threshold "$SCORE_THRESHOLD" \
  --max-retries "$MAX_RETRIES" --max-ci-retries "$MAX_CI_RETRIES"

items_json=$(bash "$SCRIPT" pick-items --evidence-dir "$EVIDENCE_DIR")
item_count=$(echo "$items_json" | jq 'length')
```

If `item_count` is 0: print "No pending items matched filters" and stop.

**Dry run**: If `--dry-run`, print the item table and stop:

```bash
echo "$items_json" | jq -r '.[] | "- \(.id) [\(.type)] [effort:\(.effort)] [score:\(.score)] \(.description)"'
```

Backup BACKLOG.md before any mutations:

```bash
cp BACKLOG.md BACKLOG.md.ralph-next-backup
```

### Step 1: Git Hygiene

```bash
git checkout main && git pull && git fetch --prune
git branch --merged main | grep -v 'main' | xargs -r git branch -d
```

### Step 2: Main Graph Loop

Iterate through items in `items_json`. For each item track:

- `attempts=0`, `transitions=2` (PICK + IMPLEMENT already logged)
- `last_failure_type`, `same_failure_streak`, `final_decision`

#### PICK State

```bash
item_id=$(echo "$item" | jq -r '.id')
item_desc=$(echo "$item" | jq -r '.description')
item_type=$(echo "$item" | jq -r '.type')
item_effort=$(echo "$item" | jq -r '.effort')

bash "$SCRIPT" log-traj "$item_id" PICK '{"mode":"next"}' --evidence-dir "$EVIDENCE_DIR"
```

#### IMPLEMENT State — **YOU do this work**

This is not a shell operation. YOU must implement the backlog item:

1. **Create a feature branch:**

   ```bash
   branch_slug=$(echo "$item_id-$item_desc" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | cut -c1-50)
   branch_type=$(echo "$item_type" | tr '[:upper:]' '[:lower:]' | grep -o '^[a-z]*')
   branch_name="${branch_type:-feat}/${branch_slug}"
   git checkout -b "$branch_name"
   ```

2. **Read and understand the item:** The description in `item_desc` tells you what to implement. Read relevant source files, understand the codebase, understand what change is needed.

3. **Implement using your tools:** Use Read, Edit, Write, Bash as needed to make the code changes.

4. **Commit:**

   ```bash
   git add -A
   git commit -m "[conventional-type]([scope]): $item_desc"
   ```

5. **Log the transition:**
   ```bash
   bash "$SCRIPT" log-traj "$item_id" IMPLEMENT \
     "{\"branch\":\"$branch_name\",\"attempt\":$attempts}" \
     --evidence-dir "$EVIDENCE_DIR"
   transitions=$((transitions + 1))
   ```

#### QUALITY State

**MANDATORY: This state MUST run before `complete-item` is called. Skipping QUALITY causes `complete-item` to fail with a missing evidence error.**

```bash
attempts=$((attempts + 1))
quality_result=$(bash "$SCRIPT" run-quality "$item_id" "$attempts" --evidence-dir "$EVIDENCE_DIR")
quality_passed=$(cut -d'|' -f1 <<< "$quality_result")
failure_type=$(cut -d'|' -f2 <<< "$quality_result")

bash "$SCRIPT" log-traj "$item_id" QUALITY \
  "{\"passed\":$quality_passed,\"failure_type\":\"$failure_type\",\"attempt\":$attempts}" \
  --evidence-dir "$EVIDENCE_DIR"
transitions=$((transitions + 1))
```

When `quality_passed=true`, the script writes `.claude/ralph-next/quality-<item_id>.json` as evidence. `complete-item` enforces this file exists before moving the item to Completed.

#### REFLECT State

Compute trajectory score:

```
quality_coverage = 1 if quality_passed else 0
first_attempt    = 1 / attempts
duration_ratio   = 1.0 if first attempt, 0.7 if retry
learning_value   = 0.6 if quality_passed, 0.2 otherwise
score = (quality_coverage * 0.4) + (first_attempt * 0.2) + (duration_ratio * 0.2) + (learning_value * 0.2)
```

Update failure streak tracking. Then log:

```bash
bash "$SCRIPT" log-traj "$item_id" REFLECT \
  "{\"score\":$score,\"quality_passed\":$quality_passed,\"failure_type\":\"$failure_type\",\"attempt\":$attempts}" \
  --evidence-dir "$EVIDENCE_DIR"
transitions=$((transitions + 1))
```

#### DECIDE State

Apply Stage A (hard gate), then Stage B (scoring) using the **Failure-Class Retry Matrix** table above. Determine `decision`: `pass`, `marginal`, `retry`, `split`, `speculate`, `escalate`, or `block`.

```bash
bash "$SCRIPT" log-traj "$item_id" DECIDE \
  "{\"action\":\"$decision\",\"attempt\":$attempts}" \
  --evidence-dir "$EVIDENCE_DIR"
transitions=$((transitions + 1))
```

**Transition guard**: If `transitions >= 8`, force `decision=block`.

**If `pass` or `marginal`:**

```bash
bash "$SCRIPT" update-item "$item_id" completed "$decision" "" "$score" true "$attempts" \
  --evidence-dir "$EVIDENCE_DIR"
bash "$SCRIPT" complete-item "$item_id" --evidence-dir "$EVIDENCE_DIR"
```

Capture a brief summary of what was implemented and any learnings in `.claude/session-learnings.md`.

**Context compaction (CS-158):** Unless `--no-compact` was passed, run `/compact` now to drop exploration context from this item before the next PICK. Keep: item ID, branch name, trajectory score, any learnings already written to `.claude/session-learnings.md`.

**If `retry`:** Check retry budget. If within budget, go back to IMPLEMENT (checkout branch, fix the failure, commit). Otherwise fall through to block.

**If `block`, `split`, `escalate`, or budget exhausted:**

```bash
bash "$SCRIPT" log-traj "$item_id" BLOCK \
  "{\"reason\":\"$decision\",\"failure_type\":\"$failure_type\"}" \
  --evidence-dir "$EVIDENCE_DIR"
bash "$SCRIPT" update-item "$item_id" blocked block "$failure_type" "$score" false "$attempts" \
  --evidence-dir "$EVIDENCE_DIR"
bash "$SCRIPT" block-item "$item_id" --evidence-dir "$EVIDENCE_DIR"
```

For `split`: create 2–3 child backlog items in BACKLOG.md and mark the parent as split-parent.

### Step 3: Session End

```bash
bash "$SCRIPT" finalize --evidence-dir "$EVIDENCE_DIR"
```

Print a summary table: items completed, items blocked, average trajectory score.
Append learnings to `.claude/session-learnings.md` if any new patterns were found.

## Files Produced

- `.claude/ralph-next/state.json`
- `.claude/ralph-next/trajectory-log.jsonl`
- `.claude/ralph-next/evidence/<ITEM_ID>.json`
- `.claude/session-learnings.md` (shared with classic workflow)

## Examples

```bash
/bs:ralph-next
/bs:ralph-next --until "3 items" --score-threshold 0.75
/bs:ralph-next --scope bug --speculate never
/bs:ralph-next --reflect-depth deep --until "2 hours"
/bs:ralph-next --classic --until "3 items"   # A/B compare with ralph-dev behavior
/bs:ralph-next --dry-run
```

## Validation

```bash
# Reliability checks for runner behavior
bash scripts/test-ralph-next.sh
```

## Related Commands

- `/bs:ralph-dev` - Classic linear autonomous backlog loop
- `/bs:quality --merge` - Required quality/merge gate
- `/bs:backlog` - Prioritize and manage backlog entries
- `/bs:workflow` - Day-to-day workflow reference
