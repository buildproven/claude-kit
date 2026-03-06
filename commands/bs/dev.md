---
name: bs:dev
description: Start development work (features, bugs, refactoring, experiments)
argument-hint: '<name> [--fix|--refactor|--experiment|--with-tests] | --next | --parallel "task1,task2,task3"'
tags: [workflow, git, dev]
category: development
model: sonnet
---

# /bs:dev - Start Development Work

**Usage**: `/bs:dev <name> [--fix|--refactor|--experiment] [--with-tests] [--parallel "task1,task2,task3"] [--teams] [--next]`

Generic command for all development work. Auto-detects branch type or use flags.

**Quick start with backlog:**

```bash
/bs:dev --next    # Auto-picks highest-scoring Ready item from BACKLOG.md
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

## What This Does

1. **Detect branch type** - From name or flag
2. **Create branch** - `<type>/<name>`
3. **Gather requirements** - Ask what to build
4. **Assess complexity** - Simple, medium, or complex?
5. **Plan appropriately** - Match planning depth to complexity
6. **Explore codebase** - Understand before implementing (medium/complex)
7. **Implement** - Build with full context
8. **Remind next step** - Suggest `/bs:quality --merge` when done

## Implementation

### Step 0a: Ensure Working Directory is Git Root

**Critical:** Always start at the git repository root to ensure file operations (BACKLOG.md, docs, etc.) work correctly.

```bash
# Find git root and cd to it
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

if [[ -z "$GIT_ROOT" ]]; then
  echo "❌ Not in a git repository"
  exit 1
fi

cd "$GIT_ROOT"
echo "📂 Working directory: $GIT_ROOT"
```

**Why this matters:**

- Git commands work from anywhere (they find root automatically)
- File operations need predictable paths (BACKLOG.md, CLAUDE.md, docs/)
- Prevents ending up in subdirectories after running build commands
- Ensures all file reads/writes use consistent paths

**Usage in commands:**

```bash
# When running commands in subdirectories, use subshells:
(cd packages/agents && pnpm build)  # Returns to original dir after

# Or use workspace filters:
pnpm --filter @vbl/agents build    # Runs in correct dir automatically
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

echo "✅ Branch hygiene complete"
```

**Why this matters:**

- Prevents working from old feature branches with stale code
- Avoids `git checkout` carrying uncommitted changes from wrong branches
- Keeps local branch list clean and manageable
- Ensures fresh state from main for new work

### Step 0c: Auto-Pick from Backlog (--next flag)

If `--next` flag is provided, automatically select the highest-scoring Ready item:

```bash
# Check for --next flag
if [[ "$@" == *"--next"* ]]; then
  # Find BACKLOG.md in current repo
  BACKLOG_PATH="BACKLOG.md"

  if [[ ! -f "$BACKLOG_PATH" ]]; then
    echo "❌ BACKLOG.md not found in current directory"
    exit 1
  fi

  # Parse BACKLOG.md for highest-scoring Ready item
  # Look in "🔥 High Value - Next Up" section
  # Find first line with Status="Ready" or "**Ready**"
  # Extract: ID, Item description, Score

  # Example line format:
  # | B-246  | VBL pipeline dry run with Claude Code | Feature | 4/5/4 | S | 13.0 | **Ready** | [→](...) |

  NEXT_ITEM=$(awk '
    /^## 🔥 High Value - Next Up/,/^## [^🔥]/ {
      if ($0 ~ /\*\*Ready\*\*/ || $0 ~ /Ready[[:space:]]*\|/) {
        match($0, /\| (B-[0-9]+)[[:space:]]*\|[[:space:]]*([^|]+)\|/, arr)
        if (arr[1] != "") {
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", arr[2])
          print arr[1] ":::" arr[2]
          exit
        }
      }
    }
  ' "$BACKLOG_PATH")

  if [[ -z "$NEXT_ITEM" ]]; then
    echo "❌ No Ready items found in 'High Value - Next Up' section"
    exit 1
  fi

  # Parse ID and description
  BACKLOG_ID="${NEXT_ITEM%%:::*}"
  ITEM_DESC="${NEXT_ITEM##*:::}"

  echo "🎯 Auto-selected from backlog:"
  echo "   ID: $BACKLOG_ID"
  echo "   Task: $ITEM_DESC"
  echo ""

  # Set NAME for branch creation (use ID)
  NAME="$BACKLOG_ID"

  # Continue to normal workflow with this item
fi
```

**Usage examples:**

```bash
/bs:dev --next                    # Auto-picks B-246 (highest Ready item)
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

# Create and checkout branch
git checkout -b $BRANCH_NAME

echo "✅ Created branch: $BRANCH_NAME"

# Initialize HUD state for live dashboard display (CS-061)
HUD_SCRIPT="${HOME}/Projects/claude-setup/scripts/hud-update.sh"
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

### Step 4: Assess Complexity (Enhanced with Sequential Thinking)

**Use Sequential Thinking for intelligent complexity assessment:**

Instead of asking manual questions, use sequential thinking to systematically analyze:

```markdown
Let me use sequential thinking to assess this task's complexity:

**Task Requirements:** [user's description from Step 3]

**Analyze step by step:**

1. **File Impact Analysis**
   - Which files will this likely touch?
   - How many files total?
   - Are they scattered or localized?

2. **Approach Analysis**
   - Is there one obvious way to implement this?
   - Or are there multiple valid approaches to consider?
   - What are the trade-offs between approaches?

3. **Architectural Implications**
   - Does this require new architectural patterns?
   - Does this change how components interact?
   - Are there system-wide implications?

4. **Dependency Analysis**
   - What existing systems does this depend on?
   - What will depend on this new code?
   - Are there circular dependency risks?

5. **Unknown Factors**
   - What do we not know yet about this codebase?
   - What assumptions are we making?
   - What could surprise us during implementation?

6. **Complexity Determination**
   Based on the above analysis:
   - File count: [X files]
   - Approaches: [Single/Multiple]
   - Architecture: [Standard/New patterns]
   - Dependencies: [Simple/Complex web]
   - Unknowns: [Few/Many]

   **Recommended Tier:** [Simple/Medium/Complex]
   **Recommended Planning Approach:** [Direct/Explore/EnterPlanMode]
   **Rationale:** [Explain why]
```

**Output to user:**

After the sequential thinking analysis, communicate clearly:

```markdown
I've analyzed the complexity of this task:

**Complexity: [TIER]**
**Rationale:** [2-3 sentence explanation based on analysis]
**Planning Approach:** [What we'll do next]

[If Medium/Complex] I'll explore the codebase first to understand existing patterns before implementing.
[If Simple] I'll implement directly with standard practices.
```

**Complexity Determination Guidelines:**

- **Simple**: 1-2 files, obvious approach, no architectural decisions, few unknowns
- **Medium**: 3-5 files, clear approach, standard patterns, some unknowns requiring exploration
- **Complex**: 6+ files OR architectural decisions OR multiple approaches OR many unknowns

### Step 5: Plan Based on Complexity

**For SIMPLE tasks:**

1. Quick exploration with Grep/Glob to find relevant files
2. Use TodoWrite to create 3-5 implementation tasks
3. Implement directly with standard practices

**For MEDIUM tasks:**

1. **Plan Exploration with Sequential Thinking:**

   Use sequential thinking to create a focused exploration strategy:

   ```markdown
   Use sequential thinking to plan codebase exploration:

   **Task:** [description]
   **Goal:** Understand existing patterns for [feature area]

   **Plan step by step:**

   1. What files should we examine first?
   2. What patterns are we looking for?
   3. What conventions need to be followed?
   4. What integration points exist?
   5. What could be a pitfall?

   **Output:**

   - Priority files to examine
   - Specific patterns to identify
   - Questions exploration should answer
   - Risk factors to watch for
   ```

2. **Execute Exploration** - Use Task tool with `Explore` agent:

   ```
   Task tool with subagent_type='Explore'
   Prompt: "Based on this exploration plan: [sequential thinking output]

           Find all files related to [feature area].
           Specifically look for:
           - [pattern 1 from analysis]
           - [pattern 2 from analysis]
           - [pattern 3 from analysis]

           Answer these critical questions:
           - [question 1 from analysis]
           - [question 2 from analysis]"
   ```

3. **Document findings** - Summarize:
   - Existing patterns to follow
   - Files that need changes
   - Dependencies and constraints
   - Unexpected findings

4. **Create implementation plan** - Use TodoWrite with specific tasks

5. **Implement** with full context from exploration

**For COMPLEX tasks:**

0. **Interview Pattern (Requirements Gathering):**

   Before planning, interview the user to build a precise spec. This prevents the butterfly effect — building an entire feature on wrong assumptions.

   ```markdown
   I need to understand this better before planning. Let me ask a few questions:

   1. **Scope:** What's the minimum viable version? What can we skip for now?
   2. **Constraints:** Any existing patterns we must follow? APIs we must use?
   3. **Edge cases:** What happens when [key scenario]? What about [error case]?
   4. **Success criteria:** How will we know this is done? What should the user see?
   5. **Non-goals:** What should this explicitly NOT do?

   [Wait for answers, then summarize into a spec before proceeding]
   ```

   **Output a spec before building:**

   ```markdown
   ## Spec: [Feature Name]

   - **Goal:** [one sentence]
   - **Scope:** [what's in / what's out]
   - **Approach:** [high-level plan]
   - **Success criteria:** [how to verify]
   - **Non-goals:** [explicitly excluded]

   Does this match your intent? If yes, I'll start planning.
   ```

1. **Pre-Plan Analysis with Sequential Thinking:**

   Use sequential thinking to frame the planning process before entering plan mode:

   ```markdown
   Use sequential thinking to frame the planning process:

   **Task:** [description]
   **Complexity Drivers:** [What makes this complex]

   **Analyze step by step:**

   1. What are the possible approaches to solving this?
   2. What are the key architectural decisions to make?
   3. What trade-offs exist between approaches?
   4. What are the risks of each approach?
   5. What unknowns need to be discovered during exploration?
   6. What should the exploration prioritize?

   **Output:**

   - List of approaches to explore
   - Critical architectural questions
   - Evaluation criteria for approaches
   - Exploration priorities
   ```

2. **Use EnterPlanMode** for thorough exploration and design:

   ```
   EnterPlanMode

   During plan mode, use sequential thinking to:
   - Evaluate each approach systematically
   - Analyze trade-offs with clear criteria
   - Build evidence for recommendations
   - Address architectural questions from step 1

   Present plan with:
   - Recommended approach
   - Why it's best (based on systematic analysis)
   - Implementation strategy
   - Risk mitigations
   ```

3. **After plan approval** - ExitPlanMode and implement

4. **Monitor complexity** - If implementation reveals more complexity:

   ```markdown
   Use sequential thinking to assess:

   1. What new complexity was discovered?
   2. Does this invalidate our approach?
   3. Should we pause and re-plan?
   4. Or can we adapt the current plan?

   Decide: Continue or Re-plan
   ```

### Step 6: Explore Before Implementing (Medium/Complex)

**Critical: Never guess or assume - explore to find truth**

**IMPORTANT: Always use a subagent for exploration.** Exploring in the main context wastes 40%+ of tokens reading files you won't need. Subagents explore in isolation and return only relevant summaries.

For medium/complex tasks, ALWAYS run exploration via subagent:

```javascript
// Use subagent to explore — keeps main context clean
Task(subagent_type: "Explore",
     prompt: `Explore the codebase for [feature area].

     Find:
     - All files related to [feature area]
     - Current implementation patterns and conventions
     - Integration points and dependencies
     - Potential challenges or constraints

     Return a focused summary with:
     - List of relevant files with their roles
     - Key patterns to follow
     - Dependencies to be aware of
     - Recommended approach based on what you found`)
```

**Why subagent exploration:**

- Main context stays clean for implementation
- Saves 40%+ input tokens (subagent reads many files, returns summary)
- Exploration context doesn't pollute coding context
- Can run multiple explorations in parallel for complex tasks

### Step 7: Development

Use TodoWrite to track tasks. Guide coding with:

- **Context from exploration** - Use discovered patterns
- **Read before writing** - Never modify unread files
- **Follow conventions** - Match project style
- **Test as you go** - Verify incrementally

**Development Best Practices:**

- Break work into small, testable chunks
- Commit logical units (don't batch everything)
- Use agents for specialized tasks (review, refactoring)
- Keep conversation focused on implementation

**Context Management:**

`/bs:quality` runs `/compact` before spawning agents (Step 1.7), so you don't need to manually compact during dev. Auto-compaction at ~150 messages handles edge cases. Just focus on coding.

**Session Length Best Practices:**

- **Aim for < 50 turns per session** — Break at natural boundaries
- After ~50 turns, context compression kicks in, losing detail and wasting tokens
- **Break pattern:** `/bs:dev` → code → `/bs:quality` → `/clear` → next feature
- Don't build entire features in one 500+ message conversation

### Step 7.5: Auto-Generate Tests for Modified Code (Optional)

**Test generation in /bs: workflow:**

- **By default:** Tests generated during `/bs:quality` (faster iteration)
- **With `--with-tests` flag:** Generate tests immediately (complete but slower)
- **Always enforced:** `/bs:quality` quality gate generates missing tests before PR

**If `--with-tests` flag is provided, ensure test coverage now:**

```markdown
Let me check if all modified code files have corresponding tests...

[Use git diff to identify changed code files]
[For each code file (.ts, .tsx, .js, .jsx):

- Check if .test._ or .spec._ file exists
- If missing, generate comprehensive unit tests
- Follow project test patterns (Vitest/Jest/etc)
- Run tests to verify they pass]

**Test Generation Summary:**

✅ Modified files with tests: [count]
✅ Generated tests for: [list of files]
✅ All tests passing

[If any files lack tests and can't auto-generate:]
⚠️ Manual test needed for: [list of files]
Add tests for these files before running /bs:quality
```

**Implementation:**

```javascript
// Use general-purpose agent or QA agent
Task(subagent_type: "general-purpose",
     prompt: "Generate tests for modified code files.

     1. Run git diff to find changed files
     2. Filter to code files (.ts, .tsx, .js, .jsx)
     3. For each code file without a .test.* or .spec.* file:
        - Read the code file
        - Generate comprehensive unit tests
        - Follow existing test patterns in the project
        - Cover main functionality and edge cases
     4. Run all tests to verify they pass

     Skip:
     - Config files (*.config.ts)
     - Type definitions (*.d.ts)
     - Files that already have tests",
     run_in_background: false)
```

**Why generate tests during dev (--with-tests):**

- Prevents coverage regression
- Catches bugs early
- Forces thinking about edge cases
- Makes `/bs:quality` faster (no test generation needed)
- Maintains high quality throughout development

**Why skip test generation (default):**

- Faster iteration during development
- Less friction for experimentation
- Tests still guaranteed before shipping (via `/bs:quality`)
- Separation of concerns: dev = speed, quality = thoroughness

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

**Why explicit completion signals:**

- Agents need clear markers to know when task is done
- Prevents premature completion or endless iteration
- Enables autonomous workflows to proceed to next step
- From agent-native research: "completion signals are critical"

## Complexity Examples

**Simple Tasks (Direct implementation):**

```bash
/bs:dev fix-typo-in-header      # 1 file, obvious fix
/bs:dev add-loading-spinner      # 1-2 files, standard pattern
```

**Medium Tasks (Explore first):**

```bash
/bs:dev user-profile-page        # 3-5 files, clear approach
/bs:dev stripe-integration       # Multiple files, established patterns
```

**Complex Tasks (Plan mode):**

```bash
/bs:dev dark-mode                # Touches many files, architectural decision
/bs:dev real-time-sync           # Multiple approaches, design needed
/bs:dev refactor-auth-system     # Large refactor, needs careful planning
```

## Command Examples

```bash
# Feature development
/bs:dev dark-mode
/bs:dev stripe-integration

# Bug fixes (auto-detected)
/bs:dev fix-login-crash
/bs:dev hotfix-payment-bug

# Bug fixes (explicit flag)
/bs:dev login-crash --fix

# Refactoring
/bs:dev refactor-api-client
/bs:dev api-client --refactor

# Experiments
/bs:dev experiment-new-algorithm
/bs:dev ai-feature --experiment
```

## Key Principles (From Optimization Guide)

**Exploration over Assumption:**

- Use Task + Explore agent for medium/complex work
- Never guess patterns - find them in the codebase
- Document findings before implementing

**Planning Depth Matches Complexity:**

- Simple: Quick exploration + TodoWrite
- Medium: Explore agent + documented plan
- Complex: EnterPlanMode + user approval

**Agent Leverage:**

- Don't do everything in main chat
- Use specialized agents (Explore, Plan, refactoring-specialist)
- Keep conversations focused (< 100 messages)

**Conversation Boundaries:**

- Break at natural milestones (feature → PR → new conversation)
- Use `/bs:quality --merge` to ship and start fresh
- Avoid 5-hour timeouts from endless sessions

## Additional Flags

| Flag                 | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `--next`             | Auto-pick highest-scoring Ready item from BACKLOG.md                    |
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

## Parallel Execution Mode

**Usage**: `/bs:dev --parallel "task1,task2,task3"`

For multiple independent features, spawn autonomous agents that work simultaneously.

### When to Use Parallel Mode

**High Value (10x ROI):**

- Independent features in different modules (no file overlap)
- Simple bug fixes in different areas
- Documentation + tests + implementation in parallel

**Low/Negative Value:**

- Tasks with shared file dependencies → merge hell
- Tasks needing human decision-making
- Coordination overhead > time saved

### How Parallel Mode Works

1. **Parse tasks** - Extract descriptions from comma-separated list
2. **Analyze dependencies** - Detect file conflicts using Sequential Thinking
3. **Group tasks** - Independent → Parallel, Conflicting → Sequential
4. **Show plan** - Display execution strategy before spawning
5. **Spawn agents** - Launch background agents for parallel work
6. **Autonomous execution** - Each agent runs: code → quality loop → PR
7. **Create PRs** - Generate pull requests in merge-safe order
8. **Auto-merge** (if `--merge`) - Merge PRs after quality passes

### Key Differences from Single Mode

**Single task (manual quality gate):**

```bash
/bs:dev "feature"      # Implement only
/bs:quality --merge    # Explicit quality gate (manual)
```

**Parallel tasks (fully autonomous):**

```bash
/bs:dev --parallel "login,signup,profile" --merge
# Each agent does: branch → code → quality → PR → merge
# Fully autonomous - no manual steps needed
```

**Why the difference?**

- **Single task**: You're hands-on, want control
- **Parallel tasks**: You're delegating, trust the workflow

### Implementation Details

Each spawned agent executes this workflow:

```markdown
Workflow for each task:

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
8. If --merge: Auto-merge PR (squash, delete branch)

This is fully autonomous - quality must hit 95% before PR creation.
```

### Backlog Update (After All Agents Complete)

**Critical:** When using `--parallel --merge`, update BACKLOG.md after all PRs are merged:

```markdown
After all parallel agents complete and PRs are merged:

1. Read BACKLOG.md
2. For each task ID that was completed:
   - Move from Active Backlog to Completed section
   - Update status to "✅ [DATE]"
   - Remove detailed description (keep only table row)
3. Update "Last Updated" line with date and summary
4. If Active Backlog is now empty, add celebration message
5. Commit the BACKLOG.md update to main

This ensures the backlog stays in sync with actual work completed.
```

**Example update:**

```markdown
# Before (Active Backlog)

| CS-025 | Lead Magnet Skill | Feature | Rev:4 Ret:3 Diff:3 | M | 5.0 | Pending |

# After (Completed section)

| CS-025 | Lead Magnet Skill | Feature | ✅ 2026-01-24 |
```

### Conflict Detection and Grouping

**Sequential Thinking analyzes each task:**

```markdown
For each task:

1. Predict file impact (which files will be touched?)
2. Detect dependencies (what systems does this depend on?)
3. Identify conflicts (compare file predictions across tasks)
4. Assess complexity (simple/medium/complex)

Output:

- Parallel group (no conflicts, run simultaneously)
- Sequential groups (conflicts detected, run in order)
```

**Example execution plan:**

```markdown
## Parallel Execution Plan

### ✅ Parallel Group (3 agents, autonomous)

These tasks have NO file conflicts - will run simultaneously:

**Task 1**: Add login page

- Files: pages/login.tsx, components/LoginForm.tsx
- Branch: feature/login-page
- Workflow: Implement → Quality loop → PR
- Estimated: 1-1.5 hours

**Task 2**: Fix header styling

- Files: components/Header.tsx, styles/header.css
- Branch: fix/header-styling
- Workflow: Implement → Quality loop → PR
- Estimated: 45-60 min

### ⚠️ Sequential Group (queued)

These tasks share files - will run one after another:

**Task 3**: Refactor auth system (FIRST)

- Files: lib/auth.ts, utils/session.ts
- Branch: refactor/auth-system
- Conflicts with: Task 4

**Task 4**: Add OAuth support (AFTER Task 3)

- Files: lib/auth.ts, pages/api/oauth.ts
- Depends on: Task 3 (shares lib/auth.ts)
- Branch: feature/oauth-support

---

**Total Time**: ~1.5 hours (parallel) + 2.5 hours (sequential) = ~2.5 hours
**Without parallelization**: ~5 hours
**Time Saved**: ~2.5 hours (50% faster)

Proceed? (y/n)
```

### Examples

**Simple parallel execution (with auto-merge):**

```bash
/bs:dev --parallel "login page,header fix,API docs" --merge

# Creates 3 branches:
# - feature/login-page
# - fix/header-fix
# - docs/api-docs

# Spawns 3 autonomous agents
# Each runs: code → quality → PR → merge
# All changes merged to main automatically
```

**Without --merge (PRs only):**

```bash
/bs:dev --parallel "login page,header fix,API docs"

# Same as above but stops at PR creation
# You review and merge manually via: gh pr merge <number> --squash --delete-branch
```

**Mixed with type flags:**

```bash
/bs:dev --parallel "fix-login-bug,refactor-api,add-dashboard"

# Auto-detects types:
# - fix/login-bug (detected "fix-" prefix)
# - refactor/api (detected "refactor-" prefix)
# - feature/add-dashboard (default)
```

### Agent Teams Mode (`--teams`) (CS-104)

**When `--teams` is set, use agent teams instead of Task subagents for parallel feature work.**

Teams mode provides: tmux split-pane visibility into each feature's coding progress, file conflict detection via teammate messages before merge, and coordinated merge ordering managed by the lead.

**When to use:** Best for 3+ independent features where you want live progress visibility. For 1-2 quick tasks, standard Task subagents are faster.

**If `--teams` is not set (default), use the standard Task subagent flow described above.**

```bash
TEAMS="${TEAMS:-false}"

if [ "$TEAMS" = true ]; then
  echo "🤝 Teams Mode: Spawning feature teammates with tmux visibility..."

  # Step T1: Create development team
  TeamCreate(team_name: "dev-parallel", description: "Parallel feature development")

  # Step T2: Create feature tasks from parsed task list
  # Each task = one feature, assigned to one teammate
  for TASK in "${PARALLEL_TASKS[@]}"; do
    TASK_NAME=$(echo "$TASK" | tr -cs 'a-zA-Z0-9' '-' | tr '[:upper:]' '[:lower:]')
    TaskCreate(
      subject: "Implement: $TASK",
      description: "Branch: feature/${TASK_NAME}. Full workflow: explore → plan → code → quality → PR.
        Files predicted: ${PREDICTED_FILES[$TASK]}.
        If you detect file conflicts with another teammate, message the lead immediately.
        Run /bs:quality --merge when implementation is complete."
    )
  done

  # Step T3: Spawn feature teammates (max 5, one per feature)
  # Each teammate gets its own tmux pane for live visibility
  for i in "${!PARALLEL_TASKS[@]}"; do
    TASK="${PARALLEL_TASKS[$i]}"
    Task(subagent_type: "general-purpose",
         team_name: "dev-parallel", name: "dev-${i}",
         prompt: "You are a feature development teammate. Check TaskList, claim an unclaimed task, and implement it end-to-end:
           1. Create feature branch
           2. Explore codebase for context
           3. Plan implementation (EnterPlanMode if complex)
           4. Implement with tests
           5. Run /bs:quality --merge
           6. Report completion to lead
           If you detect file conflicts with predicted files from other tasks, message the lead BEFORE continuing.")
  done

  # Step T4: Lead monitors progress
  # - Watch TaskList for completed/blocked tasks
  # - If teammate reports file conflict: pause conflicting task, let first finish, then resume
  # - After all tasks complete, verify all PRs merged

  # Step T5: Backlog update (same as non-teams mode)
  # Move completed items to Completed section in BACKLOG.md

  # Step T6: Shutdown team
  SendMessage(type: "broadcast", content: "All features complete. Shutting down team.")
  # Send shutdown_request to each teammate
  TeamDelete()

  echo "✅ All parallel features complete."
fi
```

**Examples with teams:**

```bash
# Parallel with tmux visibility
/bs:dev --parallel "login page,header fix,API docs" --teams --merge

# See each feature's progress in real-time tmux panes
# Teammates detect and report file conflicts before merge
```

### Safety and Best Practices

**✅ Do:**

- Start with `--dry-run` to validate the plan (future enhancement)
- Limit to 3-5 parallel agents (cost + review burden)
- Use for truly independent features
- Review PRs promptly (don't let them pile up)

**❌ Don't:**

- Spawn 10+ agents at once (expensive, overwhelming)
- Use for tasks with unclear requirements
- Ignore conflict warnings
- Merge PRs out of dependency order

### Cost and Time

**Typical scenario (3 parallel tasks):**

- Time: 1.5-2.5 hours autonomous work
- Cost: ~$10-15 (3 agents × ~$3-5 each)
- Your effort: 0 min with `--merge`, or 15-30 min reviewing PRs without

**Without parallelization:**

- Time: 4-6 hours sequential work
- Cost: ~$10-15 (same total API usage)
- Your effort: Same review time

**ROI**: 50-70% time savings with same cost

## Full Workflow

**Single task:**

```bash
/bs:dev <name>              # Start work
# ... code ...
/bs:quality --merge         # Ship it (30-60 min autonomous)
```

**Parallel tasks (with review):**

```bash
/bs:dev --parallel "task1,task2,task3"
# Wait for agents to complete (1-3 hours autonomous)
# Review PRs in GitHub UI, then merge manually
```

**Parallel tasks (fully autonomous):**

```bash
/bs:dev --parallel "task1,task2,task3" --merge
# Fully autonomous: code → quality → PR → merge
# No manual steps needed
```

## See Also

- `/bs:quality --merge` - Ship it (95% quality, auto-deploy)
- `/bs:quality --level 98 --merge` - Production-perfect (98% quality)
- `/bs:workflow` - Full workflow guide
