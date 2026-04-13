---
name: bs:dev
description: Start development work (features, bugs, refactoring, experiments)
argument-hint: '<name> [--fix|--refactor|--experiment|--with-tests|--tdd|--wt] | --next | --parallel "task1,task2,task3"'
tags: [workflow, git, dev]
category: development
model: sonnet
---

# /bs:dev - Start Development Work

**Usage**: `/bs:dev <name> [--fix|--refactor|--experiment] [--with-tests] [--tdd] [--wt] [--parallel "task1,task2,task3"] [--teams] [--next] [--alt]`

Generic command for all development work. Auto-detects branch type or use flags.

**Quick start with backlog:**

```bash
/bs:dev --next    # Auto-picks highest-priority item from Linear
```

## Auto-Detection

Smart branch naming based on your input:

```bash
/bs:dev dark-mode              # feature/dark-mode
/bs:dev fix-login-bug          # fix/login-bug (auto-detected "fix-")
/bs:dev refactor-auth          # refactor/auth (auto-detected "refactor-")
/bs:dev experiment-ai          # experiment/ai (auto-detected "experiment-")
/bs:dev hotfix-crash           # fix/crash (auto-detected "hotfix-")
```

**Detection keywords:**

- `fix-*`, `bugfix-*`, `hotfix-*` → `fix/`
- `refactor-*` → `refactor/`
- `experiment-*`, `exp-*`, `test-*` → `experiment/`
- Everything else → `feature/`

## Flags (Override Auto-Detection)

```bash
/bs:dev login-bug --fix        # fix/login-bug
/bs:dev auth --refactor        # refactor/auth
/bs:dev ai --experiment        # experiment/ai
```

## Implementation

### Step 0a: Ensure Working Directory is Git Root

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$GIT_ROOT" ]]; then echo "❌ Not in a git repository"; exit 1; fi
cd "$GIT_ROOT"
echo "📂 Working directory: $GIT_ROOT"
```

### Step 0b: Branch Hygiene - Ensure Clean State

**Critical:** Before creating any feature branch, clean up stale branches to prevent working from wrong state.

```bash
# Ensure we're on main and up to date
git checkout main && git pull && git fetch --prune

# Delete branches already merged to main (excludes current branch)
git branch --merged main | grep -v 'main' | xargs -r git branch -d

# Delete branches whose remote tracking is gone (deleted on remote)
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D

# Prune stale worktrees (auto-cleanup for --wt)
git worktree prune 2>/dev/null
# Remove worktree dirs whose branches are gone
for wt in $(git worktree list --porcelain | grep '^worktree ' | awk '{print $2}'); do
  [ "$wt" = "$GIT_ROOT" ] && continue
  wt_branch=$(git -C "$wt" branch --show-current 2>/dev/null)
  if [ -n "$wt_branch" ] && ! git show-ref --verify --quiet "refs/heads/$wt_branch" 2>/dev/null; then
    git worktree remove --force "$wt" 2>/dev/null && echo "🧹 Removed stale worktree: $wt"
  fi
done

# Ensure repo auto-deletes PR branches on merge
gh api repos/:owner/:repo --jq '.delete_branch_on_merge' | grep -q true || gh api repos/:owner/:repo -X PATCH -f delete_branch_on_merge=true > /dev/null

echo "✅ Branch hygiene complete"
```

### Step 0c: Auto-Pick from Backlog (--next flag)

If `--next` flag is provided, automatically select the highest-priority item from Linear:

```bash
# Primary: use Linear MCP
# mcp__linear__list_issues(
#   filter: { state: { name: { eq: "Backlog" } } },
#   orderBy: "priority",
#   first: 1
# )
# → extract identifier (e.g. BUI-5), title, description
# → set NAME = identifier, ITEM_DESC = title
```

**Usage examples:**

```bash
/bs:dev --next                    # Auto-picks highest-priority Linear item
/bs:dev --next --experiment       # Auto-pick + experiment branch type
```

### Step 1: Detect Branch Type

```bash
# Parse input
NAME="$1"
TYPE="feature"  # default

# Check flags first
if [[ "$@" == *"--fix"* ]]; then
  TYPE="fix"
elif [[ "$@" == *"--refactor"* ]]; then
  TYPE="refactor"
elif [[ "$@" == *"--experiment"* ]]; then
  TYPE="experiment"
# Auto-detect from name
elif [[ "$NAME" =~ ^(fix|bugfix|hotfix)- ]]; then
  TYPE="fix"
  NAME="${NAME#*-}"  # Remove prefix
elif [[ "$NAME" =~ ^refactor- ]]; then
  TYPE="refactor"
  NAME="${NAME#refactor-}"
elif [[ "$NAME" =~ ^(experiment|exp|test)- ]]; then
  TYPE="experiment"
  NAME="${NAME#*-}"
fi

BRANCH_NAME="${TYPE}/${NAME}"
```

### Step 2: Create Branch

```bash
# Get current branch for safety check
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Ensure we're on main/master
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  echo "⚠️  Currently on: $CURRENT_BRANCH"
  echo "Switch to main first? (y/n)"
  # If user says yes: git checkout main && git pull
fi

# --wt flag: create a git worktree for isolated parallel work
if [[ "$@" == *"--wt"* ]]; then
  WORKTREE_DIR="../$(basename $GIT_ROOT)-wt-${NAME}"
  git worktree add "$WORKTREE_DIR" -b $BRANCH_NAME
  cd "$WORKTREE_DIR"
  echo "✅ Created worktree: $WORKTREE_DIR (branch: $BRANCH_NAME)"
  echo "📂 Working directory changed to: $(pwd)"
else
  git checkout -b $BRANCH_NAME
  echo "✅ Created branch: $BRANCH_NAME"
  # WORKTREE_DIR is set — auto-cleanup after PR merge/quality pass
  # When work is done: git worktree remove "$WORKTREE_DIR"
fi

# Initialize HUD state for live dashboard display (CS-061)
HUD_SCRIPT="${SETUP_REPO:-$HOME/Projects/claude-kit}/scripts/hud-update.sh"
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --start --command "/bs:dev" --item "$NAME" --status "running"
fi
```

### Step 3: Gather Requirements

Ask the user what to build based on type:

**For features:**

```markdown
What should we build?

Please describe:

- User-facing functionality
- Technical requirements
- Any constraints or dependencies
```

**For bug fixes:**

```markdown
What bug are we fixing?

Please describe:

- Current behavior (broken)
- Expected behavior (correct)
- Steps to reproduce
- Any error messages
```

**For refactoring:**

```markdown
What should we refactor?

Please describe:

- Current code issues
- Target improvements
- Must preserve behavior?
```

**For experiments:**

```markdown
What are we testing?

Please describe:

- Hypothesis
- What to measure
- Success criteria
```

### Step 4: Assess Complexity

Use sequential thinking to analyze: file impact, approach options, architectural implications, dependencies, unknowns. Output: tier + rationale.

**Tiers:**

- **Simple**: 1-2 files, obvious approach, no architectural decisions
- **Medium**: 3-5 files, clear approach, some unknowns requiring exploration
- **Complex**: 6+ files OR architectural decisions OR multiple approaches OR many unknowns

### Step 4.5: Auto-detect Parallelizable Subtasks (CS-164)

**Runs automatically when complexity = Complex.** Skipped for Simple/Medium — those run sequentially.

When a task is Complex, check if it decomposes into **≥2 independent components** that could run as parallel workers. This catches cases like "add Google + GitHub + Apple OAuth" or "migrate auth, payments, and notifications to new API" where the user didn't think to use `--parallel`.

```markdown
Looking at this complex task — can I decompose it into independent subtasks?

**Subtask candidates:**

1. [component A] — touches: [predicted files]
2. [component B] — touches: [predicted files]
3. [component C] — touches: [predicted files]

**Conflict analysis:**

- A and B: [no shared files ✅ / shared file X ⚠️]
- A and C: [no shared files ✅ / shared file Y ⚠️]
- B and C: [no shared files ✅ / shared file Z ⚠️]

**Routing decision:**

- Parallel group: [A, B, C] (no conflicts) OR
- Parallel group 1: [A, B], then sequential: [C] (C depends on A+B output)
```

**Trigger conditions — route to parallel execution when ALL are true:**

- Task contains ≥2 clearly named independent components (e.g. "X, Y, and Z")
- Predicted file conflicts are ≤1 shared file across components
- Each component is substantial enough to justify a separate agent (>30 min each)

**Output to user:**

```markdown
This task has independent components I can parallelize:

🔀 **Parallel group** (spawning 2 agents):
• Agent 1: [component A] — ~[time estimate]
• Agent 2: [component B] — ~[time estimate]

⬇️ **Then sequential** (depends on parallel output):
• [component C] — ~[time estimate]

Proceed with parallel execution? [y/n]
(Or: "Run sequentially" to use single-agent mode)
```

**If user confirms (or --parallel flag already set):** Route directly to Parallel Execution Mode (see below). Set the parallel task list from the detected components — skip manual `--parallel "t1,t2"` specification.

**If user declines or components are ambiguous:** Continue to Step 5 as a single sequential COMPLEX task.

**Important:** Do NOT trigger on tasks that mention parallelism abstractly ("improve performance in multiple areas") — only trigger when there are distinct, clearly-named independent deliverables.

### Step 5: Plan Based on Complexity

**For SIMPLE tasks:** Grep/Glob to find relevant files → TodoWrite 3-5 tasks → implement.

**For MEDIUM tasks:**

1. Spawn `Explore` subagent to find relevant files, patterns, integration points
2. Document findings (patterns, files, dependencies)
3. TodoWrite with specific tasks → implement

**For COMPLEX tasks:** 0. **Interview** (or if `--interview` flag): ask Scope/Constraints/Edge cases/Success criteria/Non-goals → output spec, get approval

1. Use sequential thinking to enumerate approaches and trade-offs
2. EnterPlanMode → evaluate approaches, present recommendation → get approval → ExitPlanMode
3. Implement; if new complexity discovered, re-plan before continuing

### Step 5.5: TDD — Write Failing Tests First (--tdd flag only)

Write failing tests from spec/acceptance criteria before any implementation. Verify RED state (must fail for right reason — not import errors). Implement until GREEN.

### Step 6: Explore Before Implementing (Medium/Complex)

Check `docs/dev_guide/CONVENTIONS.md` first if it exists. Then spawn an `Explore` subagent (keeps main context clean):

```javascript
Task(subagent_type: "Explore",
     prompt: `Explore the codebase for [feature area]. Find relevant files, patterns, integration points, constraints. Return: file list with roles, key patterns, dependencies, recommended approach.`)
```

### Step 7: Development

Use TodoWrite to track tasks. Read files before editing. Follow project conventions. Test incrementally. Break at < 50 turns: `/bs:dev` → code → `/bs:quality` → `/clear`.

### Step 7.5: Auto-Generate Tests (--with-tests flag only)

Default: tests generated during `/bs:quality`. With `--with-tests`: spawn subagent to generate tests for changed code files lacking `.test.*`/`.spec.*`. Skip config files, `.d.ts`, files that already have tests. Run tests to verify they pass.

### Step 8: Completion Signal

**CRITICAL: Explicit completion marker for agents**

After implementation is complete, provide explicit completion signal:

```markdown
🎯 TASK COMPLETE

**Summary:**

- ✅ [Feature/fix description]
- Files changed: [count]
- Tests: [added/updated/passing]
- Documentation: [updated if needed]

**Next steps:**

1. Review the changes
2. Run `/bs:quality --merge` to test, create PR, deploy
   - Or `/bs:quality` if you want team review first
   - Or `/bs:quality --level 98 --merge` for production-critical work

**Branch:** $BRANCH_NAME

Use `/clear` after shipping to start fresh for next feature.
```

```bash
# Update HUD: Development complete, ready for quality (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --step "Dev complete" --status "idle"
fi
```

## Flags

| Flag                 | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `--next`             | Auto-pick highest-priority item from Linear                             |
| `--tdd`              | Write failing tests before implementation (tests become the spec)       |
| `--with-tests`       | Generate tests during dev (slower but complete)                         |
| `--fix`              | Create fix/ branch                                                      |
| `--refactor`         | Create refactor/ branch                                                 |
| `--experiment`       | Create experiment/ branch                                               |
| `--skip-branch`      | Don't create branch (use current)                                       |
| `--base <branch>`    | Branch from specific base (default: main)                               |
| `--parallel "t1,t2"` | Run multiple tasks in parallel (comma-separated list)                   |
| `--interview`        | Force interview pattern even for simple/medium tasks                    |
| `--teams`            | Use agent teams for parallel work (tmux visibility, conflict detection) |
| `--no-teams`         | Force Task subagents for parallel work (default)                        |
| `--merge`            | Auto-merge PRs after quality passes (use with --parallel)               |
| `--alt`              | Get a second-opinion alternative approach via acpx codex                |

## --alt: Second Opinion Mode

**Usage**: `/bs:dev <task> --alt`

When `--alt` is passed, after Claude generates its approach (Step 5), also fire `acpx codex` with an alternative framing of the same problem before any implementation begins.

### Behavior

1. Claude completes its normal planning phase (Step 4 → Step 5) and produces its proposed approach.
2. Immediately after the plan is ready, fire:

```bash
acpx codex exec --no-wait "Alternative approach to: [task description]. Current approach: [Claude's plan summary]. Provide a different angle — different tech, pattern, or decomposition — focusing on tradeoffs vs the current approach."
```

3. Wait for the `acpx codex` response, then present **both approaches side-by-side**:

```markdown
## Two Approaches

### Claude's Approach

[Claude's plan]

### Codex Alternative

[acpx codex output]

---

Which approach do you want to proceed with?

- **1** — Claude's approach
- **2** — Codex alternative
- **3** — Combine elements (describe what to take from each)
```

4. Implement whichever approach (or combination) the user selects.

### Fallback

If `acpx` is not installed or the command fails, skip silently and continue with Claude's approach:

```bash
if ! command -v acpx &> /dev/null; then
  echo "ℹ️  acpx unavailable — proceeding with Claude's approach only"
fi
```

Do not error out or block implementation if `acpx` is unavailable.

## Parallel Execution Mode

**Usage**: `/bs:dev --parallel "task1,task2,task3"`

Parse tasks → conflict analysis → show plan → spawn background agents (each in isolated worktree) → quality loop → PR → merge (if `--merge`).

### Implementation

Each spawned agent executes in an isolated worktree via `isolation: "worktree"`:

```javascript
// Spawn each task as an isolated worktree agent
Task(subagent_type: "general-purpose",
     isolation: "worktree",  // ← each agent gets own copy of repo, no conflicts
     run_in_background: true,
     prompt: `You are working in an isolated git worktree. Implement: ${task}

     Workflow:
     1. Create branch: feature/<task-name>
     2. Gather requirements (infer from task description)
     3. Assess complexity using Sequential Thinking
     4. Explore codebase if needed (use Task + Explore agent)
     5. Implement with TodoWrite tracking
     6. Run autonomous quality loop:
        - Run tests (fix until passing)
        - Run ESLint (fix until passing)
        - Run TypeScript check (fix until passing)
        - Run build (fix until passing)
        - Verify all checks pass (95% quality)
     7. Create PR with description
     8. If --merge: gh pr merge --auto --squash --delete-branch

     Note: You work in an isolated worktree. No coordination with other agents needed.
     Quality must hit 95% before PR creation.`)
```

### Backlog Update (After All Agents Complete)

When using `--parallel --merge`, mark completed items Done in Linear via `mcp__linear__update_issue(id, stateId)`.

### Conflict Detection and Grouping

Use Sequential Thinking to predict file impact per task. Group into **parallel** (no conflicts) and **sequential** (shared files). Show execution plan + "Proceed? (y/n)" before spawning.

### Examples

```bash
/bs:dev --parallel "login page,header fix,API docs" --merge       # 3 agents, auto-merge
/bs:dev --parallel "login page,header fix,API docs"               # 3 agents, manual review
/bs:dev --parallel "fix-login-bug,refactor-api,add-dashboard"     # auto-detects branch types
```

### Agent Teams Mode (`--teams`) (CS-104)

Best for 3+ independent features with tmux visibility. Default is Task subagents (faster).

```bash
if [ "$TEAMS" = true ]; then
  TeamCreate(team_name: "dev-parallel", description: "Parallel feature development")
  # TaskCreate per task; spawn one teammate per task (max 5): claim → branch → explore → implement → /bs:quality --merge → report
  # Lead monitors TaskList; pause conflicting tasks; after all complete: mark Done in Linear, TeamDelete()
fi
```

**Safety:** Limit to 3-5 parallel agents. Don't use for tasks with unclear requirements or sequential dependencies.
