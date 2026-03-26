---
name: bs:ralph
description: 'Autonomous backlog execution with reflection, evidence, worktree isolation, and /bs:quality --merge'
argument-hint: '[--until "10 items"] [--scope all|feature|bug|effort:S|effort:M] [--section all|high|medium|low] [--quality auto|95|98] [--classic] [--wt] [--parallel] [--reflect-depth standard|deep] [--speculate auto|always|never] [--score-threshold 0.7] [--evidence-dir .claude/ralph] [--max-retries 3] [--max-ci-retries 2] [--no-compact] [--dry-run]'
tags: [workflow, autonomous, backlog, graph, evaluation]
category: development
model: sonnet
---

> **Shared patterns reference:** `docs/ralph-patterns.md` — state machine, Linear API, learnings capture, branch naming, quality levels.

# /bs:ralph - Graph-Orchestrated Backlog Loop

**Usage**: `/bs:ralph [--until "N items"] [--scope all|feature|bug|effort:S|effort:M] [--section all|high|medium|low] [--quality auto|95|98] [--next|--classic] [--wt] [--parallel] [--reflect-depth standard|deep] [--speculate auto|always|never] [--score-threshold 0.7] [--evidence-dir .claude/ralph-next] [--max-retries N] [--max-ci-retries M] [--no-compact] [--dry-run]`

**Defaults**: 10 items, all scopes, all sections, auto quality, next mode enabled, standard reflect depth, speculate auto, score threshold 0.7

**Backlog API:** Use `mcp__linear__list_issues(filter: { state: { name: { eq: "Backlog" } } }, orderBy: "priority", first: 1)` to pick items.
Use `mcp__linear__update_issue(id, stateId)` to mark done (state = "Done").

State machine: `PICK -> IMPLEMENT -> QUALITY -> REFLECT -> DECIDE`

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
| ~~`--next`~~        | _(removed)_            | Graph loop is now the default — no flag needed                                                      |
| `--classic`         | **disabled**           | Simplified mode: skip reflection/evidence/speculate, just PICK→IMPLEMENT→QUALITY loop               |
| `--reflect-depth`   | **standard**           | `standard` = classify + score, `deep` = include extra root-cause search before decide               |
| `--speculate`       | **auto**               | `auto` triggers on effort:M+ or retry>=2, `always` enables every routed speculate, `never` disables |
| `--score-threshold` | **0.7**                | Minimum trajectory score to label PASS when quality passes                                          |
| `--evidence-dir`    | **.claude/ralph-next** | Base path for next-mode state/evidence logs                                                         |
| `--max-retries`     | **3**                  | Generic retry cap (also bounded by failure-class budgets)                                           |
| `--max-ci-retries`  | **2**                  | CI recovery attempts after PR creation                                                              |
| `--no-compact`      | **disabled**           | Skip `/compact` between items                                                                       |
| `--parallel`        | **disabled**           | Process up to MAX_TEAMMATES (5) independent items simultaneously via background worktree agents     |
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

**Thresholds:** `>= score-threshold` => PASS | `0.4-0.69` => MARGINAL | `<0.4` => FAIL | Effort `L` may use 0.6 warning threshold

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

1. Exact quality invocation shape remains `/bs:quality --merge --level [auto|95|98]`.
2. Exactly one quality invocation per attempt.
3. No concurrent quality invocation on the same branch/worktree.
4. `--classic` never writes `.claude/ralph-next/*`.
5. `--next` never mutates `.claude/ralph-dev-state.json`.
6. `--parallel` always uses worktree isolation; serial fallback items use standard Step 2 loop.

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
PARALLEL         (default: false; "--parallel" enables)
EVIDENCE_DIR     (default: ".claude/ralph-next")
MODE             (default: "next"; "--classic" sets "classic")
```

**Classic mode**: If `--classic`, run simplified PICK→IMPLEMENT→QUALITY loop without reflection, evidence logging, or speculate. Same branch/quality/merge flow, just no REFLECT→DECIDE graph.

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

**SOTA staleness check (auto-run if >7 days stale):**

```bash
SOTA_HISTORY="$SETUP_REPO/data/sota-history.json"
if [ -f "$SOTA_HISTORY" ]; then
  LAST_DATE=$(jq -r '.lastUpdated // empty' "$SOTA_HISTORY")
  if [ -n "$LAST_DATE" ]; then
    LAST_EPOCH=$(date -j -f "%Y-%m-%d" "${LAST_DATE%T*}" "+%s" 2>/dev/null || date -d "$LAST_DATE" "+%s")
    DAYS_AGO=$(( ($(date "+%s") - LAST_EPOCH) / 86400 ))
    if [ "$DAYS_AGO" -gt 7 ]; then
      echo "⚠️  SOTA last run ${DAYS_AGO} days ago — auto-running /bs:sota"
    fi
  else
    echo "⚠️  SOTA never run — auto-running /bs:sota"
  fi
else
  echo "⚠️  SOTA history missing — auto-running /bs:sota"
fi
```

If SOTA is stale (>7 days or never run), invoke `/bs:sota` before starting the main loop. This keeps the setup self-improving without manual intervention. Skip if `--dry-run`.

### Step 1: Git Hygiene

```bash
git checkout main && git pull && git fetch --prune
git branch --merged main | grep -v 'main' | xargs -r git branch -d
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D
gh api repos/:owner/:repo --jq '.delete_branch_on_merge' | grep -q true || gh api repos/:owner/:repo -X PATCH -f delete_branch_on_merge=true > /dev/null
```

### Step 1.5: Parallel Execution (--parallel flag)

If `PARALLEL` is true, bypass the sequential graph loop and run independent items concurrently.

**Independence detection:** Before spawning parallel workers, classify items as independent or serial.

```
SERIAL_FILES = ["package.json", "tsconfig.json", "CLAUDE.md", "settings.json",
                "eslint.config.cjs", ".eslintrc.*", "tailwind.config.*",
                "next.config.*", "vercel.json", ".github/workflows/*"]
MAX_TEAMMATES = 5

# For each item, extract file path references from title + description:
#   - Explicit paths: "src/components/Button.tsx", "scripts/deploy.sh"
#   - Directory references: "the auth module", "components folder"
#   - Config keywords: "eslint config", "package.json dependencies"
#
# Independence rules:
#   1. If item references any SERIAL_FILES -> must run serially (cannot parallelize)
#   2. If two items reference overlapping files/directories -> must run serially
#   3. If item has no detectable file references -> treat as independent (optimistic)
#   4. Items touching completely different directories = independent

parallel_items = []   # Can run concurrently
serial_items = []     # Must run sequentially after parallel batch

for item in items_json:
  file_refs = extract_file_references(item.title, item.description)
  if any(ref matches SERIAL_FILES for ref in file_refs):
    serial_items.append(item)
  elif any(ref overlaps with existing parallel_item refs):
    serial_items.append(item)
  else:
    parallel_items.append(item)

# Cap parallel batch at MAX_TEAMMATES
if len(parallel_items) > MAX_TEAMMATES:
  serial_items.extend(parallel_items[MAX_TEAMMATES:])
  parallel_items = parallel_items[:MAX_TEAMMATES]
```

**Dry run with --parallel**: Print the independence analysis and stop:

```bash
echo "PARALLEL PLAN:"
echo "  Independent (parallel):   items"
for item in parallel_items; do
  echo "    - \: \ [files: \]"
done
echo "  Serial (queued):   items"
for item in serial_items; do
  echo "    - \: \ [reason: \]"
done
```

**Spawn parallel workers:** Each independent item gets its own background Agent with worktree isolation.

```
results = {}

for item in parallel_items:
  item_id = item.id
  item_desc = item.description
  item_type = item.type

  branch_slug = slugify("\-")
  branch_type = item_type.lower() or "feat"
  branch_name = "\/"

  worker = Agent(
    subagent_type: "general-purpose",
    isolation: "worktree",
    run_in_background: true,
    prompt: "Execute backlog item \: \.

      You are a parallel ralph worker. Your task:
      1. Create feature branch:       2. Read and understand the item requirements
      3. Implement the changes (read files, edit, write, test)
      4. Commit with conventional commit message
      5. Push and create PR with auto-merge
      6. Run /bs:quality --merge --level       7. If quality passes, report: PASS {pr_url}
      8. If quality fails after \ retries, report: FAIL {failure_reason}

      Rules:
      - Do NOT update Linear state (lead handles this)
      - Do NOT modify CLAUDE.md, package.json, or shared config files
      - Each retry should address the specific failure type
      - Use conventional commits: [type]([scope]): description
      - Return exactly: PASS {pr_url} or FAIL {reason}"
  )

  results[item_id] = worker
```

**Wait and aggregate:** After all workers complete, collect results.

```
completed = 0
failed = 0
blocked = 0

for item_id, result in results:
  if result starts with "PASS":
    pr_url = extract_pr_url(result)
    # Write quality evidence for the item
    bash "" write-quality-evidence "" "1" "true" "" \
      --evidence-dir ""
    bash "" update-item "" completed "pass" "" "1.0" true "1" \
      --evidence-dir ""
    bash "" complete-item "" --evidence-dir ""
    # Update Linear status to Done
    mcp__linear__update_issue(id: item_id, status: "Done")
    completed += 1
  else:
    failure_reason = extract_reason(result)
    bash "" update-item "" blocked "block" "" "0" false "1" \
      --evidence-dir ""
    bash "" block-item "" --evidence-dir ""
    failed += 1

echo "PARALLEL BATCH COMPLETE:"
echo "  Passed: "
echo "  Failed: "
echo "  Total:   "
```

**Serial fallback:** After the parallel batch, process `serial_items` using the normal sequential graph loop (Step 2 below).

If `--parallel` is not set, skip this step entirely and proceed to Step 2.

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

1. **Create a feature branch:**

   ```bash
   branch_slug=$(echo "$item_id-$item_desc" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | cut -c1-50)
   branch_type=$(echo "$item_type" | tr '[:upper:]' '[:lower:]' | grep -o '^[a-z]*')
   branch_name="${branch_type:-feat}/${branch_slug}"
   # --wt flag: use git worktree for isolated parallel work
   if [[ "$@" == *"--wt"* ]]; then
     worktree_dir="../$(basename $GIT_ROOT)-wt-${item_id}"
     git worktree add "$worktree_dir" -b "$branch_name"
     cd "$worktree_dir"
     echo "📂 Worktree: $worktree_dir (branch: $branch_name)"
   else
     git checkout -b "$branch_name"
   fi
   # --wt cleanup: after quality --merge completes (or item blocked), run:
   # cd "$GIT_ROOT" && git worktree remove --force "$worktree_dir" 2>/dev/null
   ```

2. **Read and understand the item.** Read relevant source files, understand the codebase.

3. **Implement using your tools:** Use Read, Edit, Write, Bash as needed.

4. **Commit and create PR with auto-merge:**

   ```bash
   git add -A
   git commit -m "[conventional-type]([scope]): $item_desc"
   git push -u origin "$branch_name"

   pr_url=$(gh pr create --title "[conventional-type]([scope]): $item_desc" \
     --body "Closes #$item_id" 2>&1 | tail -1)
   gh pr merge --auto --squash --delete-branch 2>/dev/null || \
     gh pr merge --squash --delete-branch
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
/bs:quality --merge --level "$QUALITY_LEVEL"
quality_exit=$?
quality_passed=$([ $quality_exit -eq 0 ] && echo true || echo false)
failure_type=$([ $quality_exit -ne 0 ] && echo "quality" || echo "")

bash "$SCRIPT" write-quality-evidence "$item_id" "$attempts" "$quality_passed" "$failure_type" \
  --evidence-dir "$EVIDENCE_DIR"

bash "$SCRIPT" log-traj "$item_id" QUALITY \
  "{\"passed\":$quality_passed,\"failure_type\":\"$failure_type\",\"attempt\":$attempts}" \
  --evidence-dir "$EVIDENCE_DIR"
transitions=$((transitions + 1))
```

When `quality_passed=true`, evidence file `.claude/ralph-next/quality-<item_id>.json` is written. `complete-item` enforces this file exists before moving item to Completed.

#### REFLECT State

```
quality_coverage = 1 if quality_passed else 0
first_attempt    = 1 / attempts
duration_ratio   = 1.0 if first attempt, 0.7 if retry
learning_value   = 0.6 if quality_passed, 0.2 otherwise
score = (quality_coverage * 0.4) + (first_attempt * 0.2) + (duration_ratio * 0.2) + (learning_value * 0.2)
```

```bash
bash "$SCRIPT" log-traj "$item_id" REFLECT \
  "{\"score\":$score,\"quality_passed\":$quality_passed,\"failure_type\":\"$failure_type\",\"attempt\":$attempts}" \
  --evidence-dir "$EVIDENCE_DIR"
transitions=$((transitions + 1))
```

#### DECIDE State

Apply Stage A (hard gate), then Stage B (scoring) using the Failure-Class Retry Matrix. Determine `decision`: `pass`, `marginal`, `retry`, `split`, `speculate`, `escalate`, or `block`.

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
git checkout main
```

Capture learnings in `.claude/session-learnings.md`. Unless `--no-compact`, run `/compact` before next PICK.

**If `retry`:** Check retry budget. If within budget, go back to IMPLEMENT (checkout branch, fix failure, commit). Otherwise fall through to block.

**If `speculate`:** Run 2 isolated worktree strategies in parallel; first branch to pass quality wins:

```bash
bash "$SCRIPT" log-traj "$item_id" SPECULATE \
  "{\"strategies\":2,\"failure_type\":\"$failure_type\",\"attempt\":$attempts}" \
  --evidence-dir "$EVIDENCE_DIR"
transitions=$((transitions + 1))

# Strategy A: targeted fix on the original failure
# Strategy B: alternative approach (simplified scope or different implementation angle)
# Each agent works in its own isolated worktree — no file conflicts
strategy_a=$(Agent(
  subagent_type: "general-purpose",
  isolation: "worktree",
  run_in_background: true,
  prompt: "Speculate strategy A for $item_id: targeted fix for '$failure_type' failure.
  Checkout branch $branch_name, analyze the failure, apply targeted fix, run /bs:quality --merge.
  Return: PASS or FAIL"
))

strategy_b=$(Agent(
  subagent_type: "general-purpose",
  isolation: "worktree",
  run_in_background: true,
  prompt: "Speculate strategy B for $item_id: alternative implementation approach.
  Create new branch ${branch_name}-speculate-b, implement simplified/alternative approach,
  run /bs:quality --merge. Return: PASS or FAIL"
))

# First passing strategy wins; losing branch is archived (renamed to archive/<name>)
if [ "$strategy_a" == "PASS" ] || [ "$strategy_b" == "PASS" ]; then
  quality_passed=true
else
  decision="block"
fi
```

**If `block`, `split`, `escalate`, or budget exhausted:**

```bash
bash "$SCRIPT" log-traj "$item_id" BLOCK \
  "{\"reason\":\"$decision\",\"failure_type\":\"$failure_type\"}" \
  --evidence-dir "$EVIDENCE_DIR"
bash "$SCRIPT" update-item "$item_id" blocked block "$failure_type" "$score" false "$attempts" \
  --evidence-dir "$EVIDENCE_DIR"
bash "$SCRIPT" block-item "$item_id" --evidence-dir "$EVIDENCE_DIR"
```

For `split`: create 2–3 child Linear issues via `mcp__linear__create_issue` and mark the parent as `split-parent` in its description.

### Step 3: Session End

```bash
bash "$SCRIPT" finalize --evidence-dir "$EVIDENCE_DIR"
```

Print summary: items completed, items blocked, average trajectory score.

**Completing an item:** Call `mcp__linear__update_issue(id, stateId)` to set state to "Done" immediately after `complete-item` succeeds. No BACKLOG.md mutation needed — Linear is the source of truth.

**Evidence sync (required):**

```bash
npx prettier --write .claude/ralph-next/
git add .claude/ralph-next/
git commit -m "chore(ralph-next): session evidence $(date +%Y%m%d)"
git push
```

**Learning promotion (Step 3.1):**

```bash
LEARNINGS_FILE=".claude/session-learnings.md"
TARGET_FILE="docs/session-learnings.md"
# 1. Check if learnings file exists and has content (>50 chars)
# 2. Extract: Patterns Discovered, What Worked, Gotchas
# 3. If combined content >= 100 chars OR contains Patterns/Gotchas:
#    - Append dated section to $TARGET_FILE
#    - Commit via PR: "docs(learnings): promote ralph-next session patterns"
# 4. ALWAYS clear session-learnings.md after promotion
```

**Learning index sync (Step 3.2):**

```bash
bash scripts/extract-learnings.sh sync 2>/dev/null || echo "[ralph-next] learning index sync skipped"
```

## Automation Running Underneath

Each item's push/PR triggers these automatically (no extra config):

- **Pre-push hook**: format, lint, security scan (Semgrep/pattern fallback), gitleaks, pattern checks
- **Harness Gate CI**: risk-tiered checks on every PR (lint→patterns→security based on file risk)
- **Stop hook**: validates output quality (no console.log, TODO, `any`, debugger)

These catch issues that `/bs:quality` might miss — defense in depth.

## Files Produced

- `.claude/ralph-next/state.json`
- `.claude/ralph-next/trajectory-log.jsonl`
- `.claude/ralph-next/evidence/<ITEM_ID>.json`
- `.claude/session-learnings.md`

## Examples

```bash
/bs:ralph
/bs:ralph --until "3 items" --score-threshold 0.75
/bs:ralph --scope bug --speculate never
/bs:ralph --reflect-depth deep --until "2 hours"
/bs:ralph --classic --until "3 items"
/bs:ralph --dry-run
/bs:ralph --parallel --until "5 items"
/bs:ralph --parallel --scope feature --dry-run
```

## Validation

```bash
bash scripts/test-ralph-next.sh
```
