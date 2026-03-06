---
name: bs:quality
description: 'Autonomous quality loop with configurable thoroughness (95% or 98%)'
argument-hint: '/bs:quality → 95% default | --audit → read-only check | --scope changed → quick | --level 98 → comprehensive | --merge → auto-merge+deploy'
category: quality
model: sonnet
---

# /bs:quality - Autonomous Quality Loop

**Makes your project ship-ready in one autonomous command**

Replaces `/bs:ready` (95%) and `/bs:perfect` (98%) with a single command and `--level` flag.

**Best Practice:** Runs `test:changed` locally (fast feedback), CI runs full suite (authoritative gate). No redundant work.

## Usage

```bash
/bs:quality                      # Default: 95% quality, branch scope (30-60 min)
/bs:quality --preflight          # Quick readiness check (<10 sec) - "Am I ready to merge?"
/bs:quality --audit              # Read-only: check + score + report (no fixes, no commits)
/bs:quality --audit --deep       # Deep review: 6 agents → findings auto-added to backlog
/bs:quality --audit --deep --dry-run  # Preview backlog items without adding
/bs:quality --audit --json       # Machine-readable audit output (for CI)
/bs:quality --audit --fix        # Auto-fix common issues (lint, README, .env.example)
/bs:quality --scope changed      # Quick: 95% quality, changed files only (2-5 min)
/bs:quality --scope all          # Full: 95% quality, entire project (45-90 min)
/bs:quality --level 98           # Comprehensive: 98% quality, branch scope (1-3 hours)
/bs:quality --merge              # Auto-merge after quality loop (no deploy by default)
/bs:quality --merge --deploy     # Auto-merge + deploy + verify (full ship workflow)
/bs:quality --merge --skip-ci    # Auto-merge bypassing CI checks (use when CI is broken)
/bs:quality --merge --skip-rebase  # Skip auto-rebase if behind main (manual conflict resolution)
/bs:quality --status             # Show quality history (no quality loop)
/bs:quality --status --verbose   # Show quality trends (coverage, tests, duration)
/bs:quality --coverage-diff      # Show per-file coverage changes since last run
/bs:quality --skip-docs          # Skip documentation sync check (Step 1.8)
/bs:quality --teams              # Use agent teams (tmux visibility, cross-reviewer comms)
/bs:quality --teams --level 98   # Teams mode with comprehensive quality
/bs:quality --no-teams           # Force Task subagents (default, --teams overrides)
```

---

## Pre-Flight Check (`--preflight`)

**Quick readiness check - "Am I ready to merge?"**

**Time:** <10 seconds
**Use for:** Fast gate before starting full quality loop

**What it checks:**

- ✅ No uncommitted changes
- ✅ Tests pass (quick run)
- ✅ Lint clean
- ✅ Build works
- ✅ No secrets exposed (.env files not staged)

**Returns:**

```
✅ Ready to merge
   All pre-flight checks passed

   Next step: /bs:quality --merge
```

or

```
❌ Blockers found:
   - Uncommitted changes detected
   - 3 lint errors

   Fix these before running quality loop
```

**Perfect for:**

- Quick confidence check before committing 30-60 min to full quality
- Morning status check ("where am I?")
- CI pre-checks

**Does NOT run:** Deep agents (security, a11y, performance). Use `/bs:quality --audit` for comprehensive checks.

---

## Scope Options

### `--scope changed` (Quick - Incremental Work)

**Time:** 2-5 min
**Checks:** Uncommitted changes only
**Use for:** After small commits, rapid iteration

**What it checks:**

- Files with uncommitted changes (`git diff --name-only`)
- Runs lint, type-check, tests on changed files only
- Basic security scan (no secrets in staged files)
- No comprehensive agents (security audit, a11y, performance)

**Perfect for:**

- Commit-by-commit workflow
- Checking work before committing
- Rapid feedback during development

### `--scope branch` (Default - PR Scope)

**Time:** 30-60 min
**Checks:** All files changed in branch vs main
**Use for:** Before creating PR, end of feature work

**What it checks:**

- Files changed since branching from main (`git diff main...HEAD --name-only`)
- Full quality agents on changed files
- Integration impacts
- Regression testing

**Perfect for:**

- Ready to create PR
- Feature complete
- Before team review

### `--scope all` (Full Project)

**Time:** 45-90 min
**Checks:** Entire codebase
**Use for:** Major refactors, pre-release audits, periodic health checks

**What it checks:**

- Every file in the project
- Full quality agents on entire codebase
- Cross-cutting concerns
- Technical debt

**Perfect for:**

- After architectural changes
- Quarterly audits
- Pre-production launches

---

## Quality Levels

### Level 95 (Default - Ship-Ready)

**Time:** Varies by scope (2-5 min changed, 30-60 min branch, 45-90 min all)
**Agents:** 6 quality agents
**Use for:** Feature development, bug fixes, iterating quickly

**Exit Criteria:**

- ✅ Tests: Changed files passing (CI runs full suite)
- ✅ ESLint: 0 errors, 0 warnings
- ✅ TypeScript: strict mode, no `any`, 0 errors
- ✅ Build: successful with 0 errors
- ✅ No silent failures (empty catches, swallowed errors)
- ✅ No type safety issues (proper types, no assertions)
- ✅ Security basics: No secrets exposed, no critical OWASP issues, dependency audit
- ✅ Test coverage: Changed code files have corresponding test updates
- ✅ Test quality: Generated tests validated for meaningful coverage (not trivial)
- ✅ Documentation: Help/README updated if commands/API changed

### Level 98 (Comprehensive - Production-Perfect)

**Time:** 1-3 hours
**Agents:** 10 specialized agents (Phase 1: 7, Phase 2: 3)
**Use for:** Production launches, customer-facing features, critical code

**Additional Exit Criteria (beyond 95%):**

- ✅ Accessibility compliant (WCAG 2.1 AA)
- ✅ Performance optimized (Lighthouse > 90, Core Web Vitals green)
- ✅ Architecture reviewed (no tech debt, scalable patterns)
- ✅ Code simplified (no unnecessary complexity)
- ✅ BACKLOG.md: Item marked complete (if branch references backlog ID)

---

## Implementation

**CRITICAL: This is an AUTONOMOUS command. Do NOT stop and ask the user between loops.**

### Step -1: Ensure Working Directory is Git Root

**Critical:** Always start at the git repository root to ensure file operations work correctly.

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

**Why:** Quality checks, backlog updates, and report generation require predictable file paths. This prevents issues when running build commands that change directories.

### Step 0: Parse Arguments and Handle --status

**Flags:**

| Flag              | Default | Description                             |
| ----------------- | ------- | --------------------------------------- |
| `--level N`       | 95      | Quality level (95 or 98)                |
| `--scope S`       | branch  | Scope: changed, branch, all             |
| `--merge`         | false   | Auto-merge PR after quality             |
| `--deploy`        | false   | Deploy after merge (CS-060)             |
| `--skip-ci`       | false   | Bypass CI checks                        |
| `--skip-rebase`   | false   | Skip auto-rebase                        |
| `--status`        | false   | Show quality history and exit           |
| `--verbose`       | false   | Show trends with `--status`             |
| `--audit`         | false   | Read-only assessment                    |
| `--deep`          | false   | 6-agent deep review (with `--audit`)    |
| `--dry-run`       | false   | Preview without modifying               |
| `--fix`           | false   | Auto-fix common issues (with `--audit`) |
| `--json`          | false   | Machine-readable output                 |
| `--fresh`         | false   | Ignore cache                            |
| `--coverage-diff` | false   | Show per-file coverage changes          |
| `--skip-docs`     | false   | Skip doc sync check (Step 1.8)          |
| `--teams`         | false   | Use agent teams (tmux visibility)       |
| `--no-teams`      | -       | Force Task subagents (default)          |
| `--preflight`     | false   | Quick readiness check (<10 sec)         |

```bash
# Parse all flags into variables, then handle early-exit modes:
# 1. --status: Read .qualityrc.json, display last ready/perfect run summaries
#    With --verbose: show trend charts (coverage, tests, issues, duration) from last 10 runs
#    Check alerts: coverage drops >5%, issues doubled, build time 2x avg, cost spikes
#    Store alerts in .qualityrc.json, then exit 0
# 2. --preflight: Quick checks (uncommitted changes, tests, lint, build, secrets), exit
# 3. --audit: Run audit mode (see next section)
# 4. Default: Validate level (95|98), scope, compatibility (98 requires branch+ scope)

# Start timer and initialize HUD
START_TIME=$(date +%s)
HUD_SCRIPT="${HOME}/Projects/claude-setup/scripts/hud-update.sh"
[ -f "$HUD_SCRIPT" ] && "$HUD_SCRIPT" --start --command "/bs:quality" --status "running"
```

**Audit mode** (`--audit`): Read-only project assessment. Calculates score from 100, deducting for failures.

```bash
if [ "$AUDIT_MODE" = true ]; then
  PROJECT_NAME=$(basename "$PWD"); SCORE=100; BLOCKERS=""; WARNINGS=""

  # Detect project type (Next.js > React > Node.js > Python > Unknown, +VBL if docs/projects exists)

  # Run checks — each failure deducts from SCORE and adds to BLOCKERS or WARNINGS:
  # Git:      clean working tree (warn), branch naming (warn)
  # Code:     tests (-30), lint (-15, --fix if AUDIT_FIX), types (-15), build (-30)
  # Security: npm audit critical (-25), hardcoded secrets (-30)
  # Docs:     README (-10, --fix creates minimal), ARCHITECTURE.md (-5)
  # Deploy:   deploy config (-5), .env.example (-3, --fix generates), CI workflow (-5)

  # Score thresholds: >=90 READY TO SHIP, >=70 ALMOST READY, >=50 NEEDS WORK, <50 NOT READY
  # If --json: output JSON with project, type, score, status, blockers, warnings
  # If --deep: continue to deep review; otherwise exit 0
fi
```

**Deep review mode** (`--audit --deep`): After basic audit, spawn 6 agents in parallel via Task tool. Supports `--teams` flag for tmux visibility.

| Agent                 | Focus                               | Return format                                  |
| --------------------- | ----------------------------------- | ---------------------------------------------- |
| code-reviewer         | Bugs, logic errors, code smells     | `[{severity, title, description, file, line}]` |
| silent-failure-hunter | Empty catches, swallowed errors     | Same JSON array                                |
| type-design-analyzer  | Any abuse, weak generics, null gaps | Same JSON array                                |
| security-auditor      | OWASP top 10, secrets, injection    | Same JSON array                                |
| performance-engineer  | N+1, memory leaks, algorithms       | Same JSON array                                |
| architect-reviewer    | Tech debt, patterns, coupling       | Same JSON array                                |

All agents return critical/high findings only. After completion:

1. Display agent summary table (verdict + finding counts)
2. If `--dry-run=false` and BACKLOG.md exists: add findings as backlog items (Critical=Rev:3/Ret:4/Diff:2, High=Rev:2/Ret:3/Diff:2, Effort:S)
3. If `--dry-run=true`: preview without modifying

```bash
# Validate level (only if not showing status or audit)
if [ "$AUDIT_MODE" = false ] && [ "$QUALITY_LEVEL" != "95" ] && [ "$QUALITY_LEVEL" != "98" ]; then
  echo "❌ Invalid quality level: $QUALITY_LEVEL"
  echo "Valid options: 95 or 98"
  exit 1
fi

# Validate scope
if [ "$SCOPE" != "changed" ] && [ "$SCOPE" != "branch" ] && [ "$SCOPE" != "all" ]; then
  echo "❌ Invalid scope: $SCOPE"
  echo "Valid options: changed, branch, all"
  exit 1
fi

# Level 98 requires at least branch scope (not compatible with changed)
if [ "$QUALITY_LEVEL" = "98" ] && [ "$SCOPE" = "changed" ]; then
  echo "⚠️  Level 98 is not compatible with --scope changed"
  echo "Overriding to --scope branch for comprehensive checks"
  SCOPE="branch"
fi

echo "🎯 Target Quality: ${QUALITY_LEVEL}%"
echo "📁 Scope: $SCOPE"
echo "🔀 Auto-merge: $AUTO_MERGE"
if [ "$SKIP_CI" = true ]; then
  echo "⚠️  Skip CI: true (bypassing GitHub Actions checks)"
fi

# Start timer for duration tracking
START_TIME=$(date +%s)

# Initialize HUD state for live dashboard display (CS-061)
HUD_SCRIPT="${HOME}/Projects/claude-setup/scripts/hud-update.sh"
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --start --command "/bs:quality" --status "running"
fi
```

### Step 1: Initial Assessment

```bash
# Determine which files to check based on scope
case $SCOPE in
  "changed")
    # Only uncommitted changes
    CHANGED_FILES=$(git diff --name-only)
    CHANGED_FILES+=$'\n'$(git diff --cached --name-only)
    echo "📝 Checking uncommitted changes only"
    ;;
  "branch")
    # All files changed in branch vs main
    MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')
    CHANGED_FILES=$(git diff $MAIN_BRANCH...HEAD --name-only)
    echo "🌿 Checking branch changes vs $MAIN_BRANCH"
    ;;
  "all")
    # All files in project
    CHANGED_FILES=$(git ls-files)
    echo "🌍 Checking entire project"
    ;;
esac

# Filter to code files only (for targeted testing)
CODE_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(js|ts|jsx|tsx|py|go|java|rs)$' || true)

# Step 1.1: Detect available marketplace tools (B-262)
echo ""
echo "🔍 Detecting quality tools..."
echo ""

TRIVY_AVAILABLE=false
SEMGREP_AVAILABLE=false
LIGHTHOUSE_AVAILABLE=false

# Check for Trivy
if command -v trivy >/dev/null 2>&1; then
  TRIVY_AVAILABLE=true
  echo "  ✓ Trivy found (vulnerability scanning)"
else
  echo "  ○ Trivy not installed (install: brew install trivy)"
fi

# Check for Semgrep
if command -v semgrep >/dev/null 2>&1; then
  SEMGREP_AVAILABLE=true
  echo "  ✓ Semgrep found (security rules)"
else
  echo "  ○ Semgrep not installed (install: brew install semgrep)"
fi

# Check for Lighthouse (only for web projects)
if [ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "package.json" ]; then
  if command -v lighthouse >/dev/null 2>&1; then
    LIGHTHOUSE_AVAILABLE=true
    echo "  ✓ Lighthouse found (web performance)"
  else
    echo "  ○ Lighthouse not installed (install: npm install -g lighthouse)"
  fi
fi

echo ""

# Calculate quality score tracking
TOTAL_CHECKS=4  # Base: tests, lint, typecheck, build
PASSED_CHECKS=0
OPTIONAL_CHECKS=0

if [ "$TRIVY_AVAILABLE" = true ]; then TOTAL_CHECKS=$((TOTAL_CHECKS + 1)); OPTIONAL_CHECKS=$((OPTIONAL_CHECKS + 1)); fi
if [ "$SEMGREP_AVAILABLE" = true ]; then TOTAL_CHECKS=$((TOTAL_CHECKS + 1)); OPTIONAL_CHECKS=$((OPTIONAL_CHECKS + 1)); fi
if [ "$LIGHTHOUSE_AVAILABLE" = true ]; then TOTAL_CHECKS=$((TOTAL_CHECKS + 1)); OPTIONAL_CHECKS=$((OPTIONAL_CHECKS + 1)); fi

# Run automated checks
if [ "$SCOPE" = "changed" ]; then
  # Quick checks for changed files only
  echo "$CODE_FILES" | xargs npm run lint --fix -- 2>/dev/null || true
  npm run type-check || tsc --noEmit
  npm run test -- --findRelatedTests $(echo "$CODE_FILES" | tr '\n' ' ') || npm run test
else
  # Run checks - use test:changed locally, CI runs full suite
  npm run type-check || tsc --noEmit && PASSED_CHECKS=$((PASSED_CHECKS + 1))
  npm run lint && PASSED_CHECKS=$((PASSED_CHECKS + 1))
  npm run test:changed || npm run test -- --changed || npm run test && PASSED_CHECKS=$((PASSED_CHECKS + 1))
  npm run build && PASSED_CHECKS=$((PASSED_CHECKS + 1))
fi

# Step 1.2: Run Trivy if available (B-262)
if [ "$TRIVY_AVAILABLE" = true ]; then
  echo ""
  echo "🔒 Running Trivy vulnerability scan..."

  # Scan for vulnerabilities in dependencies
  if trivy fs --severity HIGH,CRITICAL --quiet . 2>/dev/null; then
    echo "  ✓ Trivy passed - No high/critical vulnerabilities"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  else
    echo "  ✗ Trivy failed - Vulnerabilities found"
    echo ""
    echo "Run 'trivy fs .' for full report"
  fi
fi

# Step 1.3: Run Semgrep if available (B-262)
if [ "$SEMGREP_AVAILABLE" = true ]; then
  echo ""
  echo "🛡️  Running Semgrep security rules..."

  # Run Semgrep with auto policy (community rules)
  if semgrep --config=auto --quiet --error 2>/dev/null; then
    echo "  ✓ Semgrep passed - No security issues"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  else
    echo "  ✗ Semgrep failed - Security issues found"
    echo ""
    echo "Run 'semgrep --config=auto' for full report"
  fi
fi

# Step 1.4: Run Lighthouse if available (B-262)
if [ "$LIGHTHOUSE_AVAILABLE" = true ] && [ "$SCOPE" != "changed" ]; then
  echo ""
  echo "⚡ Running Lighthouse performance audit..."

  # Check if dev server is running (required for Lighthouse)
  if lsof -i :3000 >/dev/null 2>&1; then
    # Run Lighthouse on localhost:3000
    LIGHTHOUSE_SCORE=$(lighthouse http://localhost:3000 --quiet --output=json --chrome-flags="--headless" 2>/dev/null | jq '.categories.performance.score * 100' 2>/dev/null || echo "0")

    if [ "$(echo "$LIGHTHOUSE_SCORE >= 90" | bc -l 2>/dev/null)" = "1" ]; then
      echo "  ✓ Lighthouse passed - Performance: ${LIGHTHOUSE_SCORE}/100"
      PASSED_CHECKS=$((PASSED_CHECKS + 1))
    else
      echo "  ⚠ Lighthouse warning - Performance: ${LIGHTHOUSE_SCORE}/100 (target: 90+)"
    fi
  else
    echo "  ○ Lighthouse skipped - Dev server not running (start with 'npm run dev')"
  fi
fi

# Step 1.5: Display quality score (B-262)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
QUALITY_SCORE=$(echo "scale=0; ($PASSED_CHECKS * 100) / $TOTAL_CHECKS" | bc)
echo "📊 Quality Score: ${QUALITY_SCORE}% (${PASSED_CHECKS}/${TOTAL_CHECKS} checks passed)"
echo ""

# Update HUD with quality score (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --step "Step 1: Initial Assessment" --quality "$QUALITY_SCORE"
fi

if [ $OPTIONAL_CHECKS -gt 0 ]; then
  if [ $((PASSED_CHECKS - 4)) -lt $OPTIONAL_CHECKS ]; then
    echo "💡 Install missing tools for comprehensive coverage:"
    if [ "$TRIVY_AVAILABLE" = false ]; then
      echo "   brew install trivy           # Vulnerability scanning"
    fi
    if [ "$SEMGREP_AVAILABLE" = false ]; then
      echo "   brew install semgrep         # Security rules (1000+ patterns)"
    fi
    if [ "$LIGHTHOUSE_AVAILABLE" = false ] && [ -f "package.json" ]; then
      echo "   npm install -g lighthouse    # Web performance measurement"
    fi
    echo ""
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
```

### Step 1.5.1: Alert Rules Engine (CS-065)

**Check for quality/cost anomalies and surface alerts automatically.**

Reads thresholds from `.qualityrc.json` (defaults: coverageDropThreshold=5, buildTimeThreshold=2x, costPerFeatureThreshold=$50).

```bash
check_alerts() {
  ALERTS=()
  if [ -f ".qualityrc.json" ] && [ "$(jq '.history.runs | length' .qualityrc.json)" -ge 2 ]; then
    # Coverage drop check (previous vs current run)
    COV_DROP=$(($(jq '.history.runs[-2].coverage' .qualityrc.json) - $(jq '.history.runs[-1].coverage' .qualityrc.json)))
    [ "$COV_DROP" -gt "$(jq -r '.alerts.coverageDropThreshold // 5' .qualityrc.json)" ] && ALERTS+=("Coverage dropped ${COV_DROP}%")

    # Build time check (last run vs average)
    LAST_DUR=$(jq '.history.runs[-1].duration' .qualityrc.json)
    AVG_DUR=$(jq '[.history.runs[].duration] | add / length | floor' .qualityrc.json)
    DUR_THRESHOLD=$(jq -r '.alerts.buildTimeThreshold // 2' .qualityrc.json)
    (( $(echo "$LAST_DUR > $AVG_DUR * $DUR_THRESHOLD" | bc -l 2>/dev/null) )) && ALERTS+=("Build ${LAST_DUR}min > ${DUR_THRESHOLD}x avg")
  fi

  # Cost threshold check (from ~/.claude/cost-tracking.json)
  COST_FILE="${HOME}/.claude/cost-tracking.json"
  if [ -f "$COST_FILE" ]; then
    BRANCH_COST=$(jq -r --arg b "$(git rev-parse --abbrev-ref HEAD)" '.branches[$b].cost // 0' "$COST_FILE" 2>/dev/null)
    COST_LIMIT=$(jq -r '.alerts.costPerFeatureThreshold // 50' .qualityrc.json 2>/dev/null || echo "50")
    (( $(echo "$BRANCH_COST > $COST_LIMIT" | bc -l 2>/dev/null) )) && ALERTS+=("Branch cost \$${BRANCH_COST} > \$${COST_LIMIT}")
  fi

  # Display and store alerts in .qualityrc.json
  [ ${#ALERTS[@]} -gt 0 ] && printf "⚠️ %s\n" "${ALERTS[@]}" || echo "✅ No alerts"
}
check_alerts
```

### Step 1.5.2: Test Quality Gates (CS-077)

**Validate tests are meaningful, not just present.** Runs for `branch`/`all` scope only.

For each test file (`*.test.ts`, `*.spec.ts`, etc.), checks:

- Generic test names (`it("test")`, `it("should work")`) -- flag as warning
- Tests without assertions (no `expect`/`assert` calls) -- flag as warning
- Snapshot-only tests (no behavior assertions) -- flag as info

```bash
# Scan test files, flag issues, display summary. Skip for --scope changed.
if [ "$SCOPE" != "changed" ]; then validate_test_quality; fi
```

### Step 1.5.3: Coverage Diff Tracking (CS-078)

**Per-file coverage delta tracking.** Storage: `.claude/coverage-history.json`. Shown with `--verbose` or `--coverage-diff`.

```bash
track_coverage_diff() {
  # Find coverage data: coverage/coverage-summary.json > .nyc_output > generate via test:coverage
  # If no coverage data available, suggest adding test:coverage script and return

  # Compare with previous run from .claude/coverage-history.json:
  # - Show total coverage delta (improved/decreased/unchanged)
  # - Per-file comparison: new files, improved (>0.5%), decreased (>0.5%), removed
  # - Warn on coverage decreases >2%

  # Save current run to history (keep last 10 runs)
  # Format: {timestamp, total, files: {path: pct}}
}
if [ "$SCOPE" != "changed" ] || [ "$COVERAGE_DIFF" = "true" ]; then track_coverage_diff "true"; fi
```

### Step 1.5.4: Pre-Merge Conflict Detection (CS-083)

**Check for divergence before merge to avoid conflicts.**

```bash
check_merge_readiness() {
  echo ""
  echo "🔀 Checking merge readiness..."

  MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")

  # Fetch latest from remote
  git fetch origin "$MAIN_BRANCH" --quiet 2>/dev/null || true

  # Check if branch is ancestor of main (already merged)
  if git merge-base --is-ancestor HEAD "origin/$MAIN_BRANCH" 2>/dev/null; then
    echo "  ✅ Branch is up to date with $MAIN_BRANCH"
    return 0
  fi

  # Check divergence
  LOCAL_AHEAD=$(git rev-list --count "origin/$MAIN_BRANCH..HEAD" 2>/dev/null || echo "0")
  REMOTE_AHEAD=$(git rev-list --count "HEAD..origin/$MAIN_BRANCH" 2>/dev/null || echo "0")

  if [ "$REMOTE_AHEAD" -gt 0 ]; then
    echo "  ⚠️ Branch is $REMOTE_AHEAD commits behind $MAIN_BRANCH"
    echo ""
    echo "  Auto-rebasing to avoid merge conflicts..."

    # Try to rebase
    if git rebase "origin/$MAIN_BRANCH" 2>/dev/null; then
      echo "  ✅ Successfully rebased on $MAIN_BRANCH"
    else
      # Rebase failed, abort and warn
      git rebase --abort 2>/dev/null || true
      echo "  ❌ Rebase failed - manual conflict resolution required"
      echo ""
      echo "  Run: git rebase origin/$MAIN_BRANCH"
      echo "  Then: Resolve conflicts and run /bs:quality again"
      return 1
    fi
  else
    echo "  ✅ No merge conflicts expected ($LOCAL_AHEAD commits ahead)"
  fi
}

if [ "$AUTO_MERGE" = true ] && [ "$SCOPE" != "changed" ]; then
  check_merge_readiness
fi
```

### Step 1.6: Coverage and Documentation Checks

**Runs for `--scope branch` or `--scope all` only (skipped for `--scope changed`).**

Run these checks using git diff against main:

| Check                | How to Detect                                                                       | If Issue Found                              |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| **Test coverage**    | Code file changed (`.ts/.js/.py`) without corresponding `.test.*` or `.spec.*` file | Create test file following project patterns |
| **Help sync**        | `commands/*.md` changed without `help.md` or README update                          | Update help.md with new command/flags       |
| **README API docs**  | `export` statements changed without README update                                   | Update README API section                   |
| **BACKLOG tracking** | Branch name contains `B-XXX` or `CS-XXX` but item not marked complete               | Update BACKLOG.md status                    |

```bash
# Quick detection commands
git diff main...HEAD --name-only                           # All changed files
git diff main...HEAD --name-only | grep -E '\.(ts|js)$'    # Code files
git diff main...HEAD --name-only | grep -E '\.test\.'      # Test files
```

**If issues found:** Fix autonomously, then re-check. Loop until all pass.

### Step 1.7: Context Compaction (Before Agents)

**CRITICAL: Compact context before spawning agents to ensure they have room to work.**

`/bs:quality` often runs after a long `/bs:dev` session where exploration, debugging, and file reads have filled context. Agents need headroom.

```markdown
Before spawning quality agents:

1. Run /compact to drop:
   - Exploration results from /bs:dev (file reads, grep results, codebase searches)
   - Debug output and failed attempts
   - Intermediate conversation about implementation decisions (already committed)

2. Keep:
   - List of changed files (CHANGED_FILES from Step 1)
   - Quality check results from Step 1
   - Current branch name and backlog item ID
   - Exit criteria checklist

This frees context for agents to read files, analyze code, and report findings.
```

**Skip compaction if:**

- Running standalone (not after `/bs:dev`)
- Conversation is fresh (<30 messages)
- Running `--scope changed` (no agents, no compaction needed)

### Step 1.8: Documentation Sync Check (CS-059)

**Auto-detect API changes and update documentation accordingly.**

This step runs `scripts/detect-doc-changes.sh` to scan for:

- New/changed `export` statements (API surface changes)
- Function signature changes
- New command files (`commands/*.md`)
- New skill files (`skills/*.md`)
- Modified command files (flags may have changed)

```bash
# Skip if --skip-docs flag is set
if [ "$SKIP_DOCS" = true ]; then
  echo "⏭️  Skipping documentation sync check (--skip-docs)"
else
  echo ""
  echo "📝 Step 1.8: Documentation Sync Check"
  echo ""

  # Run the detection script
  DOC_CHANGES=$(./scripts/detect-doc-changes.sh --branch 2>/dev/null || echo '{"doc_update_needed": false}')

  DOC_UPDATE_NEEDED=$(echo "$DOC_CHANGES" | jq -r '.doc_update_needed')

  if [ "$DOC_UPDATE_NEEDED" = "true" ]; then
    echo "📋 API/Command changes detected that may require documentation updates:"
    echo ""

    # Show summary
    NEW_EXPORTS=$(echo "$DOC_CHANGES" | jq -r '.summary.total_api_changes')
    NEW_COMMANDS=$(echo "$DOC_CHANGES" | jq -r '.summary.total_new_commands')
    NEW_SKILLS=$(echo "$DOC_CHANGES" | jq -r '.summary.total_new_skills')
    MODIFIED_COMMANDS=$(echo "$DOC_CHANGES" | jq -r '.summary.total_modified_commands')

    [ "$NEW_EXPORTS" -gt 0 ] && echo "  - $NEW_EXPORTS API changes (exports/signatures)"
    [ "$NEW_COMMANDS" -gt 0 ] && echo "  - $NEW_COMMANDS new command files"
    [ "$NEW_SKILLS" -gt 0 ] && echo "  - $NEW_SKILLS new skill files"
    [ "$MODIFIED_COMMANDS" -gt 0 ] && echo "  - $MODIFIED_COMMANDS modified command files"
    echo ""

    echo "📄 Docs that may need updating:"
    echo "$DOC_CHANGES" | jq -r '.docs_to_update[]' | while read doc; do
      echo "  - $doc"
    done
    echo ""

    # Spawn doc-writer agent to handle updates
    DOC_UPDATE_NEEDED_FLAG=true
  else
    echo "  ✓ No API changes detected - documentation is in sync"
    DOC_UPDATE_NEEDED_FLAG=false
  fi
fi
```

**If documentation updates needed**, spawn a doc-writer agent:

```javascript
if (DOC_UPDATE_NEEDED_FLAG) {
  Task(subagent_type: "general-purpose",
       prompt: `You are a documentation writer agent. Update documentation based on detected changes.

Changes detected:
${JSON.stringify(DOC_CHANGES, null, 2)}

Instructions:
1. For API changes (new exports, changed signatures):
   - Update README.md API section if it exists
   - Update JSDoc comments if functions lack documentation

2. For new command files:
   - Read the new command file(s)
   - Update commands/bs/help.md with command name, description, and flags
   - Follow existing help.md format exactly

3. For new skill files:
   - Read the new skill file(s)
   - Add to README.md skills section if it exists

4. For modified command files:
   - Check if flags or usage changed
   - Update commands/bs/help.md accordingly

5. After making updates:
   - Show a diff of changes for review
   - Stage the documentation files

Do NOT:
- Create new documentation files (only update existing)
- Add verbose explanations (match existing style)
- Change formatting/structure of existing docs

Return summary of updates made.`,
       run_in_background: false)
}
```

**Skip documentation check if:**

- Running with `--skip-docs` flag
- Running with `--scope changed` (incremental, not PR-ready)
- No API-impacting changes detected

### Step 2: Autonomous Agent Loop

**For Scope `changed` (Quick Check - Skip Agents):**

```bash
# For quick checks, skip agents entirely - automated checks are enough
# Only run lint, type-check, tests from Step 1
# If all pass, proceed directly to Step 3 verification
echo "⚡ Quick check mode - using automated tooling only"

# Update HUD for quick check mode (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --step "Quick check complete" --status "running"
fi
```

### Agent Teams Mode (`--teams`) (CS-103)

**When `TEAMS=true`, use agent teams instead of Task subagents for reviewer coordination.**

Teams mode provides: tmux split-pane visibility into each reviewer's progress, cross-reviewer communication (e.g., security reviewer flags auth issue → code reviewer checks related code), and coordinated retry on failures.

**When to use:** Best for `--level 98` or `--scope all` runs where review takes 10+ minutes. For quick `--scope changed` runs, Task subagents are faster (no team setup overhead).

**If `TEAMS=false` (default), skip this section and use the standard Task subagent flow below.**

```bash
# Parse --teams flag (default: false)
TEAMS="${TEAMS:-false}"

if [ "$TEAMS" = true ]; then
  echo "🤝 Teams Mode: Spawning reviewer teammates with tmux visibility..."

  # Step T1: Create quality review team
  # Uses TeamCreate tool to set up team + shared task list
  TeamCreate(team_name: "quality-review", description: "Quality review for ${BRANCH_NAME}")

  # Step T2: Create review tasks in shared task list
  # Each task maps to a reviewer role — teammates will claim and work them
  TaskCreate(subject: "Code quality review", description: "Review ${SCOPE} files for bugs, logic errors, code smells. Files: ${CHANGED_FILES}")
  TaskCreate(subject: "Silent failure hunt", description: "Find empty catches, swallowed errors, unhandled rejections. Files: ${CHANGED_FILES}")
  TaskCreate(subject: "Type safety analysis", description: "Check for any abuse, weak generics, null safety gaps. Files: ${CHANGED_FILES}")
  TaskCreate(subject: "Security audit", description: "OWASP top 10, secrets exposure, injection vulnerabilities. Files: ${CHANGED_FILES}")
  TaskCreate(subject: "Test generation", description: "Generate tests for code files lacking coverage. Files: ${CHANGED_FILES}")
  TaskCreate(subject: "Test quality review", description: "Validate test meaningfulness and edge case coverage. Files: ${CHANGED_FILES}")

  # Level 98 adds these tasks:
  if [ "$QUALITY_LEVEL" = "98" ]; then
    TaskCreate(subject: "Code simplification", description: "Simplify overly complex code. Files: ${CHANGED_FILES}")
    TaskCreate(subject: "Accessibility audit", description: "WCAG 2.1 AA compliance check. Files: ${CHANGED_FILES}")
    TaskCreate(subject: "Performance review", description: "Lighthouse, Core Web Vitals, bundle analysis. Files: ${CHANGED_FILES}")
    TaskCreate(subject: "Architecture review", description: "Pattern violations, tech debt, scalability. Files: ${CHANGED_FILES}")
  fi

  # Step T3: Spawn reviewer teammates (max 4 for cost management)
  # Each teammate gets a tmux pane — visible progress in real time
  Task(subagent_type: "pr-review-toolkit:code-reviewer",
       team_name: "quality-review", name: "code-reviewer",
       prompt: "You are a quality review teammate. Check TaskList for available review tasks, claim one, and work it. When done, mark completed and check for more. Broadcast critical findings to team.")

  Task(subagent_type: "pr-review-toolkit:silent-failure-hunter",
       team_name: "quality-review", name: "failure-hunter",
       prompt: "You are a quality review teammate. Check TaskList for available review tasks, claim one, and work it. When done, mark completed and check for more. Broadcast critical findings to team.")

  Task(subagent_type: "security-auditor",
       team_name: "quality-review", name: "security-reviewer",
       prompt: "You are a quality review teammate. Check TaskList for available review tasks, claim one, and work it. When done, mark completed and check for more. Broadcast critical findings to team.")

  Task(subagent_type: "general-purpose",
       team_name: "quality-review", name: "test-reviewer",
       prompt: "You are a quality review teammate. Check TaskList for available review tasks — prioritize test generation and test quality tasks. Claim one, work it, mark completed, check for more. Broadcast critical findings to team.")

  # Step T4: Lead waits for all tasks to complete
  # Monitor TaskList — all tasks must reach 'completed' status
  # If a teammate broadcasts a critical finding, create a follow-up task for it
  # Timeout: 15 min for Level 95, 30 min for Level 98

  # Step T5: Collect results from task list and validate (CS-079)
  # Same validation as Step 2.4.1 below — check expected sections, min content length

  # Step T6: Shutdown teammates and delete team
  SendMessage(type: "broadcast", content: "All review tasks complete. Shutting down team.")
  # Send shutdown_request to each teammate, then:
  TeamDelete()

  echo "✅ Teams review complete. Proceeding to Step 3."
  # Skip to Step 3 (verification) — do NOT run the Task subagent flow below
fi
```

**If `TEAMS=false` (default), use the standard Task subagent flow:**

**For Scope `branch` or `all` + Level 95 (Core Quality — 6 agents):**

```bash
# Update HUD: Starting agent loop (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --step "Step 2/4: Running quality agents" --status "running"
fi
```

```javascript
// Spawn quality agents in parallel
Task(subagent_type: "pr-review-toolkit:code-reviewer",
     prompt: "Review code quality on ${SCOPE} files. Loop until 0 errors/warnings.

     Files to review: ${CHANGED_FILES}",
     run_in_background: false)

Task(subagent_type: "pr-review-toolkit:silent-failure-hunter",
     prompt: "Find and fix silent failures in ${SCOPE} files. Loop until 0 critical issues.

     Files to review: ${CHANGED_FILES}",
     run_in_background: false)

Task(subagent_type: "pr-review-toolkit:type-design-analyzer",
     prompt: "Analyze type safety in ${SCOPE} files. Loop until no `any` abuse, proper types.

     Files to review: ${CHANGED_FILES}",
     run_in_background: false)

// Security baseline (secrets, OWASP basics, dependency audit)
Task(subagent_type: "security-auditor",
     prompt: "Security audit on ${SCOPE} files. Check for secrets exposure, OWASP top 10 basics,
     and dependency vulnerabilities. Flag critical/high issues only.

     Files to review: ${CHANGED_FILES}",
     run_in_background: false)

// Generate tests for any code files lacking test coverage
Task(subagent_type: "general-purpose",
     prompt: "Generate tests for modified code files that lack test coverage.

     Changed files: ${CHANGED_FILES}

     For each code file (.ts, .tsx, .js, .jsx) that doesn't have a corresponding
     .test.* or .spec.* file:
     1. Read the code file to understand its functionality
     2. Generate comprehensive unit tests using the project's test framework
     3. Follow existing test patterns in the codebase
     4. Cover main functionality and important edge cases
     5. Run the tests to verify they pass

     Skip test generation for:
     - Config files (*.config.ts)
     - Type definition files (*.d.ts)
     - Files that already have tests",
     run_in_background: false)

// Validate test quality (runs after test generation)
Task(subagent_type: "pr-review-toolkit:pr-test-analyzer",
     prompt: "Review test coverage quality and completeness for ${SCOPE} files.
     Verify tests are meaningful (not trivial), cover edge cases, and validate
     business logic. Flag gaps rated 7+ (out of 10) as critical.

     Files to review: ${CHANGED_FILES}",
     run_in_background: false)
```

**For Scope `branch` or `all` + Level 98 (Comprehensive Quality - Phase 1 — 7 agents):**

**NOTE:** Level 98 is not compatible with `--scope changed`. If both are specified, override scope to `branch`.

```javascript
// Phase 1: All Level 95 agents + code simplification
// Agents 1-6: Same as Level 95 (code-reviewer, silent-failure-hunter,
// type-design-analyzer, security-auditor, test generation, pr-test-analyzer)
// Run all Level 95 agents first (see above), then add:

Task(subagent_type: "pr-review-toolkit:code-simplifier",
     prompt: "Simplify overly complex code in ${SCOPE} files. Loop until maintainable.

     Files to review: ${CHANGED_FILES}",
     run_in_background: false)
```

**For Level 98 (Phase 2 - Deep Quality — 3 agents):**

```javascript
// Phase 2: Accessibility, performance, architecture (audit-focused, mostly read-only)
Task(subagent_type: "accessibility-tester",
     prompt: "A11y audit. WCAG 2.1 AA compliance.

     Files to review: ${CHANGED_FILES}")

Task(subagent_type: "performance-engineer",
     prompt: "Performance audit. Lighthouse > 90, Core Web Vitals green.

     Files to review: ${CHANGED_FILES}")

Task(subagent_type: "architect-reviewer",
     prompt: "Architecture review. Scalable patterns, no tech debt.

     Files to review: ${CHANGED_FILES}")
```

### Step 2.4.1: Agent Result Validation (CS-079)

**After agents complete, validate their outputs to catch silent failures.**

This validation step:

1. Checks for expected sections per agent type
2. Verifies minimum content length (not just empty)
3. Flags generic phrases like "No issues found" without context
4. Provides validation summary with pass/fail/retry stats
5. Retries failed agents once before marking as failed

```bash
# Expected sections per agent type (CS-079)
declare -A AGENT_EXPECTED_SECTIONS
AGENT_EXPECTED_SECTIONS["code-reviewer"]="findings,summary,severity_breakdown"
AGENT_EXPECTED_SECTIONS["silent-failure-hunter"]="findings,patterns_checked,risk_level"
AGENT_EXPECTED_SECTIONS["type-design-analyzer"]="findings,type_coverage,any_usage_count"
AGENT_EXPECTED_SECTIONS["security-auditor"]="findings,vulnerabilities,secrets_scan,owasp_check"
AGENT_EXPECTED_SECTIONS["test-analyzer"]="findings,coverage_gaps,test_quality_score"
AGENT_EXPECTED_SECTIONS["accessibility-tester"]="findings,wcag_violations,a11y_score"
AGENT_EXPECTED_SECTIONS["performance-engineer"]="findings,lighthouse_scores,web_vitals"
AGENT_EXPECTED_SECTIONS["architect-reviewer"]="findings,pattern_violations,tech_debt_items"
AGENT_EXPECTED_SECTIONS["code-simplifier"]="findings,complexity_reduced,files_simplified"

# Minimum content length per agent (chars) - avoid empty/trivial responses
declare -A AGENT_MIN_CONTENT_LENGTH
AGENT_MIN_CONTENT_LENGTH["code-reviewer"]=50
AGENT_MIN_CONTENT_LENGTH["silent-failure-hunter"]=30
AGENT_MIN_CONTENT_LENGTH["type-design-analyzer"]=30
AGENT_MIN_CONTENT_LENGTH["security-auditor"]=50
AGENT_MIN_CONTENT_LENGTH["test-analyzer"]=30
AGENT_MIN_CONTENT_LENGTH["accessibility-tester"]=30
AGENT_MIN_CONTENT_LENGTH["performance-engineer"]=50
AGENT_MIN_CONTENT_LENGTH["architect-reviewer"]=50
AGENT_MIN_CONTENT_LENGTH["code-simplifier"]=30

# Generic phrases that indicate low-quality responses when used alone
GENERIC_PHRASES=(
  "No issues found"
  "All checks passed"
  "Everything looks good"
  "No problems detected"
  "Code is clean"
  "No vulnerabilities"
  "LGTM"
  "Looks good to me"
  "Nothing to report"
)

validate_agent_results() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔍 Agent Result Validation (CS-079)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Ensure agent results directory exists
  mkdir -p .claude/agent-results

  # Tracking arrays
  VALIDATION_ISSUES=()
  AGENTS_PASSED=()
  AGENTS_FAILED=()
  AGENTS_NEED_RETRY=()

  # Determine which agents ran based on quality level
  if [ "$QUALITY_LEVEL" = "98" ]; then
    AGENTS_TO_CHECK="code-reviewer silent-failure-hunter type-design-analyzer security-auditor test-analyzer code-simplifier accessibility-tester performance-engineer architect-reviewer"
  else
    AGENTS_TO_CHECK="code-reviewer silent-failure-hunter type-design-analyzer security-auditor test-analyzer"
  fi

  # Validate each agent's results
  for agent in $AGENTS_TO_CHECK; do
    AGENT_RESULT_FILE=".claude/agent-results/${agent}.json"
    AGENT_STATUS="unknown"
    AGENT_ISSUES=()

    if [ ! -f "$AGENT_RESULT_FILE" ]; then
      # Agent didn't produce output file - check if it should have run
      AGENT_STATUS="missing"
      AGENT_ISSUES+=("No output file found")
      AGENTS_NEED_RETRY+=("$agent")
    else
      # Get file content for validation
      CONTENT=$(cat "$AGENT_RESULT_FILE" 2>/dev/null)
      CONTENT_LENGTH=${#CONTENT}

      # Check 1: Verify timestamp exists (agent actually ran)
      RAN_AT=$(echo "$CONTENT" | jq -r '.timestamp // "none"' 2>/dev/null)
      if [ "$RAN_AT" = "none" ] || [ "$RAN_AT" = "null" ] || [ -z "$RAN_AT" ]; then
        AGENT_ISSUES+=("Missing timestamp (may not have run)")
      fi

      # Check 2: Verify expected sections exist
      EXPECTED="${AGENT_EXPECTED_SECTIONS[$agent]:-findings}"
      IFS=',' read -ra SECTIONS <<< "$EXPECTED"
      MISSING_SECTIONS=()
      for section in "${SECTIONS[@]}"; do
        HAS_SECTION=$(echo "$CONTENT" | jq -e ".$section" 2>/dev/null)
        if [ $? -ne 0 ]; then
          MISSING_SECTIONS+=("$section")
        fi
      done
      if [ ${#MISSING_SECTIONS[@]} -gt 0 ]; then
        AGENT_ISSUES+=("Missing expected sections: ${MISSING_SECTIONS[*]}")
      fi

      # Check 3: Minimum content length
      MIN_LENGTH="${AGENT_MIN_CONTENT_LENGTH[$agent]:-30}"
      if [ "$CONTENT_LENGTH" -lt "$MIN_LENGTH" ]; then
        AGENT_ISSUES+=("Content too short (${CONTENT_LENGTH} chars < ${MIN_LENGTH} min)")
      fi

      # Check 4: Check for generic phrases without context
      FINDINGS_TEXT=$(echo "$CONTENT" | jq -r '.findings[]? | .description // .message // .title // empty' 2>/dev/null)
      SUMMARY_TEXT=$(echo "$CONTENT" | jq -r '.summary // empty' 2>/dev/null)
      ALL_TEXT="$FINDINGS_TEXT $SUMMARY_TEXT"

      for phrase in "${GENERIC_PHRASES[@]}"; do
        if echo "$ALL_TEXT" | grep -qi "$phrase"; then
          # Check if there's substantive content alongside the generic phrase
          SUBSTANTIVE_LENGTH=$(echo "$ALL_TEXT" | sed "s/$phrase//gi" | tr -d '[:space:]' | wc -c | tr -d ' ')
          if [ "$SUBSTANTIVE_LENGTH" -lt 20 ]; then
            AGENT_ISSUES+=("Generic response: '$phrase' without substantive context")
          fi
        fi
      done

      # Check 5: Verify findings are actionable (have file:line references if findings exist)
      FINDINGS_COUNT=$(echo "$CONTENT" | jq -r '.findings | length' 2>/dev/null || echo "0")
      if [ "$FINDINGS_COUNT" -gt 0 ]; then
        ACTIONABLE=$(echo "$CONTENT" | jq -r '.findings[]? | select(.file != null and .line != null) | .file' 2>/dev/null | wc -l | tr -d ' ')
        if [ "$ACTIONABLE" -eq 0 ]; then
          AGENT_ISSUES+=("$FINDINGS_COUNT findings lack file:line references")
        fi
      fi

      # Check 6: Validate JSON is well-formed
      if ! echo "$CONTENT" | jq empty 2>/dev/null; then
        AGENT_ISSUES+=("Malformed JSON output")
      fi

      # Determine agent status
      if [ ${#AGENT_ISSUES[@]} -eq 0 ]; then
        AGENT_STATUS="passed"
        AGENTS_PASSED+=("$agent")
      elif [ ${#AGENT_ISSUES[@]} -le 2 ]; then
        # Minor issues - still valid but with warnings
        AGENT_STATUS="warning"
        AGENTS_PASSED+=("$agent")
        for issue in "${AGENT_ISSUES[@]}"; do
          VALIDATION_ISSUES+=("⚠️ $agent: $issue")
        done
      else
        # Multiple issues - needs retry
        AGENT_STATUS="failed"
        AGENTS_NEED_RETRY+=("$agent")
        for issue in "${AGENT_ISSUES[@]}"; do
          VALIDATION_ISSUES+=("❌ $agent: $issue")
        done
      fi
    fi

    # Print individual agent status
    case "$AGENT_STATUS" in
      "passed")
        echo "  ✅ $agent: Valid"
        ;;
      "warning")
        echo "  ⚠️  $agent: Valid with warnings"
        ;;
      "failed"|"missing")
        echo "  ❌ $agent: Invalid - needs retry"
        ;;
    esac
  done

  echo ""

  # Display validation issues if any
  if [ ${#VALIDATION_ISSUES[@]} -gt 0 ]; then
    echo "Issues detected:"
    for issue in "${VALIDATION_ISSUES[@]}"; do
      echo "  $issue"
    done
    echo ""
  fi

  # Retry failed agents once (CS-079: retry-once-or-fail logic)
  if [ ${#AGENTS_NEED_RETRY[@]} -gt 0 ]; then
    echo "🔄 Retrying ${#AGENTS_NEED_RETRY[@]} agent(s) once..."
    echo ""

    for agent in "${AGENTS_NEED_RETRY[@]}"; do
      echo "  Retrying: $agent..."

      # Re-run the agent (using Task tool pattern from Step 2.4)
      # This is a placeholder - actual retry happens via Task tool invocation
      RETRY_RESULT_FILE=".claude/agent-results/${agent}.json"

      # Mark for retry in a tracking file so the quality loop knows to re-invoke
      echo "$agent" >> .claude/agent-results/.retry-queue

      # Check if retry file now exists and is valid
      if [ -f "$RETRY_RESULT_FILE" ]; then
        RETRY_CONTENT=$(cat "$RETRY_RESULT_FILE" 2>/dev/null)
        RETRY_VALID=$(echo "$RETRY_CONTENT" | jq -e '.timestamp' 2>/dev/null)
        if [ $? -eq 0 ]; then
          echo "    ✅ $agent: Retry successful"
          AGENTS_PASSED+=("$agent")
          # Remove from failed list
          AGENTS_FAILED=("${AGENTS_FAILED[@]/$agent}")
        else
          echo "    ❌ $agent: Retry failed - marking as failed"
          AGENTS_FAILED+=("$agent")
        fi
      else
        echo "    ❌ $agent: Retry failed - no output"
        AGENTS_FAILED+=("$agent")
      fi
    done
    echo ""
  fi

  # Final validation summary (CS-079: summary of validation results)
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 Validation Summary"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Passed:  ${#AGENTS_PASSED[@]}"
  echo "  Failed:  ${#AGENTS_FAILED[@]}"
  echo "  Retried: ${#AGENTS_NEED_RETRY[@]}"
  echo ""

  # Store validation results in JSON for tracking (CS-082: agent performance tracking)
  VALIDATION_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  cat > .claude/agent-results/.validation-summary.json << EOF
{
  "timestamp": "$VALIDATION_TIMESTAMP",
  "quality_level": "$QUALITY_LEVEL",
  "passed": [$(printf '"%s",' "${AGENTS_PASSED[@]}" | sed 's/,$//')],
  "failed": [$(printf '"%s",' "${AGENTS_FAILED[@]}" | sed 's/,$//')],
  "retried": [$(printf '"%s",' "${AGENTS_NEED_RETRY[@]}" | sed 's/,$//')],
  "issues": [$(printf '"%s",' "${VALIDATION_ISSUES[@]}" | sed 's/,$//' | sed 's/"/\\"/g')],
  "all_valid": $([ ${#AGENTS_FAILED[@]} -eq 0 ] && echo "true" || echo "false")
}
EOF

  # Return validation status
  if [ ${#AGENTS_FAILED[@]} -gt 0 ]; then
    echo "❌ Agent validation FAILED - ${#AGENTS_FAILED[@]} agent(s) invalid"
    echo ""
    echo "Failed agents: ${AGENTS_FAILED[*]}"
    echo ""
    echo "Consider:"
    echo "  1. Re-running the quality loop"
    echo "  2. Investigating agent failures manually"
    echo "  3. Checking if files being reviewed exist"
    return 1
  else
    echo "✅ Agent validation PASSED"
    return 0
  fi
}

# Run after agents complete (skip for quick changed-only scope)
if [ "$SCOPE" != "changed" ]; then
  validate_agent_results
  VALIDATION_STATUS=$?

  # If validation failed and not in a retry loop, halt quality loop
  if [ "$VALIDATION_STATUS" -ne 0 ]; then
    echo ""
    echo "⚠️  Quality loop paused due to agent validation failures."
    echo "Review the issues above before proceeding."
  fi
fi
```

### Step 2.5: Intelligent Loop Decision (Sequential Thinking)

**After agents complete, use Sequential Thinking to assess status:**

```markdown
Use sequential thinking to assess quality loop status:

**Agent Results:**

- Code Reviewer: [Status and issues found/fixed]
- Silent Failure Hunter: [Status and issues found/fixed]
- Type Design Analyzer: [Status and issues found/fixed]
- Security Auditor: [Status and issues found/fixed]
- Test Generator: [Status and tests created]
- Test Analyzer: [Status and coverage gaps found]
  [... other agents if level 98 ...]

**Analyze step by step:**

1. **Issue Inventory**
   - Which agents reported remaining issues?
   - What's the severity? (Critical/High/Medium/Low)
   - How many issues per domain?

2. **Exit Criteria Check (Level ${QUALITY_LEVEL})**
   - Tests: [100% passing? Y/N]
   - ESLint: [0 errors/warnings? Y/N]
   - TypeScript: [Strict, no any? Y/N]
   - Build: [Successful? Y/N]
   - Silent failures: [0 found? Y/N]
   - Type safety: [Strong? Y/N]
   - Security: [No secrets, no critical OWASP issues? Y/N]
   - Test quality: [Meaningful coverage, not trivial? Y/N]
     [If level 98:]
   - Accessibility: [WCAG 2.1 AA? Y/N]
   - Performance: [Lighthouse > 90? Y/N]
   - Architecture: [Clean? Y/N]

3. **Blockers Analysis**
   - What's blocking ${QUALITY_LEVEL}% standard?
   - Can these be auto-fixed?
   - How many loops have we done?

4. **Recommendation**
   **Option A:** All criteria met → Proceed to Step 3 (Final Verification)
   **Option B:** Re-run specific agents → [Which ones and why]
   **Option C:** Stop and report → [If stuck after 2+ loops]

**Decision:** [A/B/C with rationale]
```

**Based on decision:**

- **If Option A:** Proceed to Step 2.6 (Deferred Findings Tracking)
- **If Option B:** Re-run specified agents, then return to Step 2.5
- **If Option C:** Report current status and blockers to user

### Step 2.6: Track Deferred Findings to Backlog

**After agents complete and before final verification, capture any findings that were categorized as "defer" (not worth fixing in this PR but should be tracked).**

For each deferred finding from agent results:

1. **Determine next backlog ID** - Read BACKLOG.md, find highest B-XXX ID, increment
2. **Score the item** - Use standard (Rev + Ret + Diff) ÷ Effort formula
3. **Add row to BACKLOG.md** in the appropriate value section (High/Medium/Low)
4. **Format:**

```markdown
| B-XXX | [Brief description of deferred finding] | Tech Debt | [R/R/D] | S | [Score] | Backlog | From /bs:quality on [branch-name] |
```

**Rules:**

- Only track findings that are real issues (not style preferences)
- Use the correct Type based on the nature of the finding:
  - `Tech Debt` — dead code, duplicate interfaces, missing type safety
  - `Bug` — inconsistent behavior, wrong defaults, normalization issues
  - `Feature` — missing capability, incomplete integration, new functionality needed
  - `Refactor` — structural improvements, pattern violations
  - `Perf` — performance issues identified but not blocking
- Link to the PR where it was deferred if available (e.g., `Deferred from PR #XX`)
- If no findings were deferred, skip this step silently
- Keep BACKLOG.md lean: one table row per item, no inline analysis

### Step 3: Verify Exit Criteria

After Sequential Thinking analysis approves (Option A), verify ALL exit criteria pass:

```bash
# Update HUD: Verifying exit criteria (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --step "Step 3/4: Verifying exit criteria"
fi

# Re-run automated checks (test:changed locally, CI runs full suite)
npm run type-check && npm run lint && (npm run test:changed || npm run test) && npm run build
```

**If ANY check fails:**

- Re-run failed agent
- Loop until pass
- Do NOT proceed to Step 4

**If ALL checks pass:**

- Proceed to Step 3.5 (Auto-commit for --scope changed)
- If not --scope changed, proceed to Step 4

### Step 3.5: Auto-Commit (Only for --scope changed)

**If SCOPE is "changed":**

```bash
# Get current branch and extract scope
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCH_SCOPE=""

# Extract scope from branch name
if [[ "$CURRENT_BRANCH" =~ ^(feature|fix|refactor|experiment)/(.+)$ ]]; then
  BRANCH_TYPE="${BASH_REMATCH[1]}"
  BRANCH_SCOPE="${BASH_REMATCH[2]}"
fi

# Analyze what changed
CHANGED_FILES=$(git diff --name-only)
CHANGED_SUMMARY=$(git diff --stat)

# Generate smart commit message using AI
# Prompt: "Based on this branch ($CURRENT_BRANCH) and these changes:
# $CHANGED_SUMMARY
#
# Generate a concise commit message following conventional commits format:
# <type>(<scope>): <description>
#
# Where:
# - type: feat, fix, refactor, chore, docs, test, style
# - scope: ${BRANCH_SCOPE} (from branch name)
# - description: what actually changed (one line, imperative mood)
#
# Examples:
# feat(dark-mode): add toggle component
# fix(login): handle empty password validation
# refactor(auth): simplify token validation logic
#
# Only return the commit message, nothing else."

COMMIT_MSG=$(# AI generates message here)

# Commit with generated message
git add .
git commit -m "$COMMIT_MSG"

echo "✅ Auto-committed: $COMMIT_MSG"
echo ""
echo "📝 Next: Continue coding or run /bs:quality --merge when feature is complete"

# Exit (don't create PR for scope changed)
exit 0
```

**If SCOPE is "branch" or "all":**

- Continue to Step 4 (create PR)

### Step 4: Commit and Create PR

```bash
# Update HUD: Creating PR (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --step "Step 4/4: Creating PR"
fi

# Get current branch name
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Commit quality improvements
git add .
git commit -m "${QUALITY_LEVEL}% quality: All checks passing

- Tests: 100% passing
- ESLint: Clean
- TypeScript: Strict, no any
- Build: Successful
- Silent failures: Fixed
- Type safety: Improved
$(if [ "$QUALITY_LEVEL" = "98" ]; then echo "- Security: Audited
- Accessibility: WCAG 2.1 AA
- Performance: Optimized
- Architecture: Reviewed"; fi)

🤖 Generated with Claude Code /bs:quality --level ${QUALITY_LEVEL}"

# Push current branch and create PR
git push -u origin $CURRENT_BRANCH
gh pr create --title "${QUALITY_LEVEL}% Quality - Ship Ready" --body "Autonomous quality loop completed (level ${QUALITY_LEVEL}%). All checks passing."

# Update HUD: PR created, quality complete (CS-061)
if [ -f "$HUD_SCRIPT" ]; then
  "$HUD_SCRIPT" --end --quality "$QUALITY_SCORE"
fi
```

### Step 4.5: Update Quality History

**After successful commit, update .qualityrc.json with run history:**

```bash
# Get commit hash
COMMIT_HASH=$(git rev-parse HEAD)

# Get current timestamp
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Calculate test coverage (if available)
COVERAGE=$(npm run test:coverage 2>&1 | grep -oP '\d+(?=%)' | head -1 || echo "0")

# Count tests
TEST_COUNT=$(npm test 2>&1 | grep -oP '\d+(?= (tests?|passing))' | head -1 || echo "0")

# Calculate duration (from quality loop start)
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_MIN=$((DURATION / 60))

# Update .qualityrc.json with history
if [ -f ".qualityrc.json" ]; then
  # Determine which history field to update based on quality level
  if [ "$QUALITY_LEVEL" = "98" ]; then
    HISTORY_KEY="lastPerfect"
  else
    HISTORY_KEY="lastReady"
  fi

  # Add to runs array for trend tracking (keep last 30 runs)
  jq --arg ts "$TIMESTAMP" \
     --arg commit "$COMMIT_HASH" \
     --arg level "$QUALITY_LEVEL" \
     --arg scope "$SCOPE" \
     --arg cov "$COVERAGE" \
     --arg tests "$TEST_COUNT" \
     --arg duration "$DURATION_MIN" \
     --arg issues "$ISSUES_FIXED" \
     --arg key "$HISTORY_KEY" \
     '
     # Update last run summary
     .history[$key] = {
       timestamp: $ts,
       commit: $commit,
       passed: true,
       coverage: ($cov | tonumber? // 0),
       issuesFixed: ($issues | tonumber? // 0)
     } |
     # Append to runs array for trends
     .history.runs = (
       (.history.runs // []) + [{
         timestamp: $ts,
         commit: $commit,
         level: ($level | tonumber),
         scope: $scope,
         coverage: ($cov | tonumber? // 0),
         testCount: ($tests | tonumber? // 0),
         duration: ($duration | tonumber? // 0),
         issuesFixed: ($issues | tonumber? // 0)
       }] | .[-30:]  # Keep last 30 runs only
     )
     ' .qualityrc.json > .qualityrc.json.tmp && mv .qualityrc.json.tmp .qualityrc.json

  # Commit the updated quality history
  git add .qualityrc.json
  git commit -m "chore: Update quality history for /bs:quality --level ${QUALITY_LEVEL} run"
  git push origin $CURRENT_BRANCH
else
  echo "⚠️ .qualityrc.json not found, skipping history update"
fi
```

### Step 5: Report to User (if --merge not passed)

```markdown
✅ ${QUALITY_LEVEL}% Quality Achieved

**Time:** X minutes
**Issues fixed:** Y
**PR:** [link]

### What Passed:

- ✅ Tests: 100% (X/X passing)
- ✅ ESLint: 0 errors, 0 warnings
- ✅ TypeScript: Strict mode, no `any`
- ✅ Build: Successful
- ✅ Silent failures: 0 found
- ✅ Type safety: Improved
  $(if [ "$QUALITY_LEVEL" = "98" ]; then echo "- ✅ Security: Audit passed
- ✅ Accessibility: WCAG 2.1 AA compliant
- ✅ Performance: Lighthouse > 90
- ✅ Architecture: Clean patterns"; fi)

**Next:** Review PR and merge
```

If `--merge` flag was passed, continue to Step 6.

### Step 6: Auto-Merge and Deploy (if --merge flag passed)

**ONLY run this step if `--merge` flag was passed.**

```bash
if [ "$AUTO_MERGE" = true ]; then
  PR_NUMBER=$(gh pr view --json number --jq '.number')
  [ -z "$PR_NUMBER" ] && echo "❌ Could not determine PR number" && exit 1

  # Step 6.1: Wait for CI checks (unless --skip-ci)
  if [ "$SKIP_CI" = true ]; then
    echo "⚠️  Skipping CI checks (--skip-ci flag), using --admin to bypass"
  else
    # Poll CI checks with 10-minute timeout
    TIMEOUT=600; ELAPSED=0; INTERVAL=10
    while [ $ELAPSED -lt $TIMEOUT ]; do
      PENDING=$(gh pr checks "$PR_NUMBER" --json state --jq '.[] | select(.state != "COMPLETED")' | wc -l)
      if [ "$PENDING" -eq 0 ]; then
        FAILED=$(gh pr checks "$PR_NUMBER" --json conclusion --jq '.[] | select(.conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED")' | wc -l)
        [ "$FAILED" -eq 0 ] && echo "✅ All CI checks passed" && break
        echo "❌ CI checks failed. Use --skip-ci to bypass." && exit 1
      fi
      sleep $INTERVAL; ELAPSED=$((ELAPSED + INTERVAL))
    done
    [ $ELAPSED -ge $TIMEOUT ] && echo "⚠️  CI checks timed out" && exit 1
  fi

  # Step 6.15: Pre-merge conflict detection (CS-083)
  MAIN_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
  git fetch origin "$MAIN_BRANCH" --quiet
  COMMITS_BEHIND=$(git rev-list --count "$(git merge-base HEAD origin/$MAIN_BRANCH)..origin/$MAIN_BRANCH")

  if [ "$COMMITS_BEHIND" -gt 0 ]; then
    if [ "$SKIP_REBASE" = true ]; then
      echo "⚠️  Branch $COMMITS_BEHIND behind main, --skip-rebase set"
    elif git rebase "origin/$MAIN_BRANCH" 2>/dev/null; then
      git push --force-with-lease || { echo "❌ Failed to push rebased branch"; exit 1; }
    else
      git rebase --abort
      echo "❌ Rebase failed - resolve conflicts manually, then re-run /bs:quality --merge"
      exit 1
    fi
  fi

  # Step 6.2: Merge PR
  if [ "$SKIP_CI" = true ]; then
    gh pr merge "$PR_NUMBER" --squash --delete-branch --admin
  else
    gh pr merge "$PR_NUMBER" --squash --auto --delete-branch
  fi
  [ $? -ne 0 ] && echo "❌ Failed to merge PR" && exit 1
  echo "✅ PR merged successfully"

  # Step 6.25: Update backlog item if detected in branch name
  BACKLOG_ITEM=$(echo "$CURRENT_BRANCH" | grep -oP '(B-\d+|[A-Z]+\d+)' | head -1 || true)
  if [ -n "$BACKLOG_ITEM" ] && [ -f "BACKLOG.md" ]; then
    TODAY=$(date +%Y-%m-%d)
    ITEM_LINE=$(grep "| ${BACKLOG_ITEM} " BACKLOG.md | head -1)
    if [ -n "$ITEM_LINE" ]; then
      # Extract item name and type from table row
      ITEM_NAME=$(echo "$ITEM_LINE" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3}')
      ITEM_TYPE=$(echo "$ITEM_LINE" | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $4); print $4}')

      # Remove from active backlog (table row + detail block)
      sed -i.bak "/| ${BACKLOG_ITEM} /d" BACKLOG.md && rm -f BACKLOG.md.bak
      sed -i.bak "/^### ${BACKLOG_ITEM}:/,/^##[# ]/{ /^##[# ]/!d; }" BACKLOG.md && rm -f BACKLOG.md.bak

      # Add completed entry after "## Completed ✅" header
      COMPLETED_ROW="| ${BACKLOG_ITEM} | ${ITEM_NAME} | ${ITEM_TYPE} | ✅ ${TODAY} |"
      sed -i.bak "/^## Completed/a\\
\\
${COMPLETED_ROW}" BACKLOG.md && rm -f BACKLOG.md.bak

      # Push via PR (avoids block-push-main hook)
      git add BACKLOG.md && git commit -m "docs(backlog): move ${BACKLOG_ITEM} to Completed"
      SYNC_BRANCH="sync/backlog-$(date +%Y%m%d-%H%M%S)"
      git checkout -b "$SYNC_BRANCH" && git push -u origin "$SYNC_BRANCH"
      gh pr create --title "docs(backlog): move ${BACKLOG_ITEM} to Completed" --body "Auto-updated by /bs:quality --merge"
      gh pr merge --squash --delete-branch
      git checkout "$MAIN_BRANCH" && git pull --rebase origin "$MAIN_BRANCH"
    fi
  fi

  # Step 6.3: Switch to main, sync, clean up stale branches
  git checkout "$MAIN_BRANCH" && git pull
  git branch --merged "$MAIN_BRANCH" | grep -v "\*\|$MAIN_BRANCH\|master" | xargs -r git branch -d 2>/dev/null
  git fetch --prune
  git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -D 2>/dev/null

  # Step 6.4: Deploy (only if --deploy flag)
  if [ "$AUTO_DEPLOY" = true ]; then
    DEPLOY_SUCCESS=false
    if [ -f "vercel.json" ] || [ -d ".vercel" ]; then
      vercel --prod && DEPLOY_SUCCESS=true
    elif [ -f "netlify.toml" ] || [ -d ".netlify" ]; then
      netlify deploy --prod && DEPLOY_SUCCESS=true
    fi

    # Create GitHub release if version bumped
    if [ -f "package.json" ]; then
      VERSION=$(jq -r '.version' package.json)
      git tag | grep -q "^v${VERSION}$" || gh release create "v${VERSION}" --generate-notes --latest
    fi

    # Step 6.5: Verify deployment with auto-rollback (CS-060)
    if [ "$DEPLOY_SUCCESS" = true ]; then
      VERIFY_FLAGS="--auto-rollback"
      [ -f ".verifyrc.json" ] && [ "$(jq -r '.createIssueOnFailure // true' .verifyrc.json)" = "true" ] && VERIFY_FLAGS="$VERIFY_FLAGS --create-issue"
      /bs:verify $VERIFY_FLAGS || { echo "❌ Deployment verification failed (auto-rollback triggered)"; exit 1; }
    fi
  fi

  # Step 6.6: Final report
  echo "✅ $([ "$AUTO_DEPLOY" = true ] && echo "SHIP" || echo "MERGE") COMPLETE - ${QUALITY_LEVEL}% QUALITY"
  echo "PR #$PR_NUMBER merged. Next: /clear to start fresh conversation."
else
  echo "ℹ️  PR created but not merged (no --merge flag)"
fi
```

---

**See also:** `/bs:dev`, `/bs:test`, `/bs:deps`, `/bs:git-sync` | **Reference:** `docs/quality-reference.md` for audit scoring, coverage tracking details, and JSON schemas.
