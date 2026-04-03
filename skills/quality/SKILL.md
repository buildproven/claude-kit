---
name: quality
description: Autonomous quality loop with configurable thoroughness (95% or 98%). Runs lint, tests, build, security scans, and specialized quality agents. Auto-fixes issues and creates PRs.
context: fork
---

# Quality Skill — Autonomous Quality Loop

Makes your project ship-ready in one autonomous command. Replaces manual review cycles with parallel quality agents.

**CRITICAL: This is AUTONOMOUS. Do NOT stop and ask the user between loops.**

## Execution Flow

### Step -1: Ensure Git Root

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
cd "$GIT_ROOT" || exit 1
```

### Step 0: Parse Arguments

Read `reference.md` for flag definitions. Key flags: `--level` (95|98), `--scope` (changed|branch|all), `--merge`, `--deploy`, `--preflight`, `--audit`, `--teams`.

Handle early exits: `--status` shows history, `--preflight` runs quick checks (<10s), `--audit` runs read-only assessment.

### Step 1: Automated Checks

1. **Determine files** based on scope (changed/branch/all)
2. **Run checks**: TypeScript (`tsc --noEmit`), ESLint, build
3. **Optional tools**: Trivy (vulns), Semgrep (security), Lighthouse (web perf)
4. **Calculate quality score** from passed/total checks

### Step 1.3: Hard Test Gate (BLOCKING)

Tests must exist and pass. This is a hard blocker, not advisory. Skip with `--skip-tests` for config-only repos.

#### 1.3a: Test Existence Check

For each changed source file, verify a corresponding test file exists:

```bash
CHANGED_SRC=$(git diff --name-only main...HEAD | grep -E '\.(ts|tsx|js|jsx)$' | grep -v -E '\.(test|spec|d)\.' | grep -v -E '(config|setup|types|index\.d)\.')
MISSING_TESTS=""

for src in $CHANGED_SRC; do
  # Derive expected test path: src/foo.ts → src/foo.test.ts OR tests/foo.test.ts
  base=$(echo "$src" | sed 's/\.\(ts\|tsx\|js\|jsx\)$//')
  ext=$(echo "$src" | grep -oE '\.(ts|tsx|js|jsx)$')

  # Check multiple patterns
  found=false
  for pattern in "${base}.test${ext}" "${base}.spec${ext}" "tests/$(basename ${base}).test${ext}" "__tests__/$(basename ${base}).test${ext}"; do
    if [ -f "$pattern" ]; then found=true; break; fi
  done

  if [ "$found" = false ]; then
    MISSING_TESTS="$MISSING_TESTS\n  - $src"
  fi
done

if [ -n "$MISSING_TESTS" ]; then
  echo "⚠️ Source files without tests:$MISSING_TESTS"
  # Not a hard fail — test-generator agent will create them in Step 1.8
  # But flag it so test-generator knows what to target
  TEST_GAPS="$MISSING_TESTS"
fi
```

**Exempt file patterns** (no test required): `*.config.*`, `*.d.ts`, `types.ts`, `index.ts` (re-exports only), migration files, seed files.

#### 1.3b: Run Tests (Hard Gate)

```bash
# Run test suite — this MUST pass
npm test 2>&1
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ Tests failed — attempting auto-fix (up to 3 attempts)"

  for attempt in 1 2 3; do
    echo "Fix attempt $attempt/3..."
    # Read test output, identify failures, fix them
    npm test 2>&1
    TEST_EXIT=$?
    if [ $TEST_EXIT -eq 0 ]; then break; fi
  done

  if [ $TEST_EXIT -ne 0 ]; then
    echo "❌ HARD FAIL: Tests still failing after 3 fix attempts"
    echo "Cannot proceed to review agents with broken tests."
    exit 1
  fi
fi
echo "✅ All tests passing"
```

#### 1.3c: Test-Generator Targeting

Pass `$TEST_GAPS` to the `test-generator` agent in Step 1.8 so it generates tests for specifically identified gaps. After test-generator runs, re-run `npm test` to verify generated tests pass:

```bash
npm test 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Generated tests are failing — fix before continuing"
  # Auto-fix loop (same 3 attempts)
fi
```

### Step 1.5: Semantic Pattern Analysis

Run defensive pattern analysis on changed files. See `checklist.md` for pattern categories.

### Step 1.6: Test Coverage Validation

Scan test files for quality issues. Read `checklist.md` "Test Quality" section for validation criteria.

### Step 1.7: Documentation Sync Check

Detect API changes, new commands, modified exports. Skip with `--skip-docs`. Spawn doc-writer agent if changes detected.

### Step 1.8: Quality Agents

**Scope `changed`**: Skip agents — automated checks are sufficient.

**Scope `branch`/`all` + Level 95** — 6 agents in parallel:

| Agent                 | Focus                            | Model  |
| --------------------- | -------------------------------- | ------ |
| code-reviewer         | Bugs, logic errors, code smells  | opus   |
| silent-failure-hunter | Empty catches, swallowed errors  | opus   |
| type-design-analyzer  | Type safety, generics, null gaps | opus   |
| security-auditor      | OWASP top 10, secrets, injection | opus   |
| test-generator        | Generate missing tests           | sonnet |
| pr-test-analyzer      | Validate test quality            | opus   |

**Level 98** adds Phase 1 (code-simplifier) + Phase 2 (accessibility-tester, performance-engineer, architect-reviewer).

#### Diff Context Injection (CRITICAL)

Before spawning agents, capture the diff and file list:

```bash
DIFF=$(git diff main...HEAD)
CHANGED_FILES=$(git diff --name-only main...HEAD)
```

Each agent prompt MUST include:

1. The actual diff content (not "run git diff" — the agent should NOT re-fetch)
2. The list of changed files
3. The branch name and commit messages (`git log main..HEAD --oneline`)
4. Relevant project conventions from CLAUDE.md

Template for agent prompt:

```
Review the following code changes for [AGENT_FOCUS].

## Changed Files
$CHANGED_FILES

## Diff
$DIFF

## Commit History
$COMMIT_LOG

## Project Conventions
[Extract relevant rules from CLAUDE.md]

Return findings as structured output with file:line references.
Do NOT review unchanged code. Focus ONLY on the diff.
```

This prevents agents from doing generic scans and forces them to review the actual changes.

#### Codex Cross-Review (Default)

Runs in parallel with Claude agents — different model, different blind spots. Enabled by default when `acpx` and `codex` are available. Disable with `--no-codex`.

```bash
# Check availability
if command -v acpx &>/dev/null && command -v codex &>/dev/null && [ "$NO_CODEX" != true ]; then
  TIMESTAMP=$(date +%s)
  DIFF_FILE=$(mktemp)
  git diff main...HEAD > "$DIFF_FILE"

  acpx codex exec --no-wait -s "codex-review-$TIMESTAMP" \
    "You are reviewing a code PR. Focus on P0/P1 issues only: bugs that will break in production, security vulnerabilities, data loss risks, and logic errors. Ignore style, formatting, and minor improvements.

For each finding, output:
- File and line number
- Severity (P0 = must fix, P1 = should fix)
- What breaks and why
- Specific fix

Files changed:
$(git diff --name-only main...HEAD)

Diff:
$(cat "$DIFF_FILE")

If no P0/P1 issues found, say so with the number of files and lines reviewed."

  rm -f "$DIFF_FILE"
fi
```

After Claude agents complete, check if Codex review is done:

```bash
if [ -n "$TIMESTAMP" ]; then
  # Poll for completion (max 120s — Codex is fast)
  for i in $(seq 1 40); do
    if ! acpx status -s "codex-review-$TIMESTAMP" 2>/dev/null | grep -q "running"; then
      break
    fi
    sleep 3
  done
  CODEX_OUT=$(acpx output -s "codex-review-$TIMESTAMP" 2>/dev/null || echo "Codex review timed out")
fi
```

Merge Codex findings into the report. Codex findings that overlap with Claude findings increase confidence. New Codex findings get added to WARNINGS.

#### Review Stamp

After all agents pass, add a commit trailer to the merge commit message:

```
Reviewed-By: claude-quality (L95, 6 agents + codex, [timestamp])
```

If Codex was unavailable or skipped: `Reviewed-By: claude-quality (L95, 6 agents, [timestamp])`

CI can check for this trailer to verify local review ran. See harness-gate.yml.

### Step 2: Agent Result Validation

Validate agent outputs per `checklist.md` "Agent Validation" section. Check expected sections, minimum content length, and reject generic responses.

### Step 2.5: Judge Agent — Finding Synthesis (CRITICAL)

**Purpose**: Filter noise, deduplicate, severity-classify. This is the most impactful step for review quality (per HubSpot: "most impactful change" in their AI review system — fewer, better, more actionable comments).

After all agent results are validated, run a single synthesis pass:

1. **Collect** all findings from: Claude agents + Codex cross-review
2. **Deduplicate**: Same file:line from multiple agents → merge into one finding, note which agents flagged it (higher confidence)
3. **Severity classify** every finding into exactly one category:
   - **BLOCKING** — Bugs, security vulns, data loss, breaking changes. Must fix before merge.
   - **WARNING** — Missing edge cases, performance concerns, weak error handling. Should fix.
   - **SUPPRESSED** — Style nits, import ordering, naming preferences, suggestions for unchanged code. Do NOT report.
4. **Confidence boost**: Findings flagged by 2+ independent agents (e.g., Claude code-reviewer AND Codex) are promoted one severity level
5. **Output**: Consolidated report with only BLOCKING and WARNING findings. Include finding count and agent attribution.

```
## Quality Review Summary

**Reviewed by**: 6 Claude agents (Opus) + Codex cross-review
**Files**: N files, M lines changed
**Findings**: X blocking, Y warnings (Z suppressed)

### BLOCKING
[findings with file:line, why it matters, specific fix]

### WARNINGS
[findings with file:line, impact, fix suggestion]

### VERDICT: PASS | FAIL
```

**Rules**:

- If 0 BLOCKING findings → PASS
- If any BLOCKING findings → auto-fix loop (up to 3 attempts) → re-run agents on fixed code → if still BLOCKING → FAIL
- SUPPRESSED findings are never shown to the user
- An empty report (0 blocking, 0 warnings) is a valid outcome — it means the code is clean. Do NOT fabricate findings.

### Step 3: Verification & Commit

1. Re-run automated checks to confirm fixes
2. Generate smart commit message from branch name + changes
3. For `--scope changed`: auto-commit and exit
4. For `--scope branch`/`all`: create PR

### Step 4: Merge & Deploy (if `--merge`)

**HARD GATE — Review Trailer Required (NON-NEGOTIABLE)**

Before calling `gh pr merge`, verify the review pipeline actually ran:

```bash
# Check for Reviewed-By trailer in commits on this branch
if ! git log main..HEAD --format=%B | grep -q "Reviewed-By: claude-quality"; then
  echo "❌ MERGE BLOCKED: No 'Reviewed-By: claude-quality' trailer found."
  echo "   The review pipeline (Step 1.8) did not run or did not complete."
  echo "   You MUST run the full quality loop including review agents before --merge."
  echo "   Do NOT manually add this trailer — it is only valid when produced by Step 1.8."
  exit 1
fi
```

This gate prevents merging when review agents were skipped — whether by shortcutting, by error, or by running only automated checks. The trailer is written in Step 1.8 (Review Stamp) ONLY after all review agents + judge synthesis complete. No trailer = no merge. No exceptions.

1. Push branch, create PR via `gh pr create`
2. Wait for CI (unless `--skip-ci`)
3. Auto-merge via `gh pr merge --squash`
4. Remind the user to verify deployment health with their normal deployment tooling

### Step 5: Record Quality History

Update `.qualityrc.json` with run results (score, coverage, duration, cost). Display next-step suggestions.

## Parallel Sub-Review Mode (acpx)

When invoked with `--parallel`, fire security, coverage, and perf sub-reviews as concurrent acpx sessions instead of running them sequentially inside the main loop.

### Usage

```
/bs:quality --parallel [other flags]
```

### How It Works

1. **Check acpx availability**: `command -v acpx`. If unavailable, fall back to sequential (log a warning).
2. **Fire sub-reviews concurrently**:

```bash
TIMESTAMP=$(date +%s)
acpx claude exec --no-wait -s "quality-security-$TIMESTAMP" \
  "Security review: examine [diff/files] for OWASP top 10, secrets, injection flaws. Output structured findings." \
  > /tmp/quality-security.pid
acpx claude exec --no-wait -s "quality-coverage-$TIMESTAMP" \
  "Coverage review: examine [diff/files] for missing tests, uncovered branches, weak assertions. Output structured findings." \
  > /tmp/quality-coverage.pid
acpx claude exec --no-wait -s "quality-perf-$TIMESTAMP" \
  "Performance review: examine [diff/files] for N+1 queries, unguarded loops, missing memoization. Output structured findings." \
  > /tmp/quality-perf.pid
```

3. **Poll until all sessions complete**:

```bash
for session in quality-security-$TIMESTAMP quality-coverage-$TIMESTAMP quality-perf-$TIMESTAMP; do
  while acpx status -s "$session" | grep -q "running"; do sleep 3; done
done
```

4. **Collect outputs**:

```bash
SECURITY_OUT=$(acpx output -s "quality-security-$TIMESTAMP")
COVERAGE_OUT=$(acpx output -s "quality-coverage-$TIMESTAMP")
PERF_OUT=$(acpx output -s "quality-perf-$TIMESTAMP")
```

5. **Synthesize**: combine all three outputs into the unified quality report (same format as sequential mode). Continue to Step 2 (Agent Result Validation) as normal.

### Fallback

If `acpx` is not installed or any session fails to launch, log:

```
[quality] acpx unavailable or launch failed — falling back to sequential sub-reviews
```

Then run security → coverage → perf in order using the standard sequential flow.

## Supporting Files

- `reference.md` — Flag definitions, scope options, quality levels, audit mode, teams mode
- `checklist.md` — Exit criteria, agent validation rules, scoring, pattern categories
