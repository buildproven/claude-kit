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
2. **Run checks**: TypeScript (`tsc --noEmit`), ESLint, tests (`test:changed` locally), build
3. **Optional tools**: Trivy (vulns), Semgrep (security), Lighthouse (web perf)
4. **Calculate quality score** from passed/total checks

### Step 1.5: Semantic Pattern Analysis

Run defensive pattern analysis on changed files. See `checklist.md` for pattern categories.

### Step 1.6: Test Coverage Validation

Scan test files for quality issues. Read `checklist.md` "Test Quality" section for validation criteria.

### Step 1.7: Documentation Sync Check

Detect API changes, new commands, modified exports. Skip with `--skip-docs`. Spawn doc-writer agent if changes detected.

### Step 1.8: Quality Agents

**Scope `changed`**: Skip agents — automated checks are sufficient.

**Scope `branch`/`all` + Level 95** — 6 agents in parallel:

| Agent                 | Focus                            |
| --------------------- | -------------------------------- |
| code-reviewer         | Bugs, logic errors, code smells  |
| silent-failure-hunter | Empty catches, swallowed errors  |
| type-design-analyzer  | Type safety, generics, null gaps |
| security-auditor      | OWASP top 10, secrets, injection |
| test-generator        | Generate missing tests           |
| pr-test-analyzer      | Validate test quality            |

**Level 98** adds Phase 1 (code-simplifier) + Phase 2 (accessibility-tester, performance-engineer, architect-reviewer).

### Step 2: Agent Result Validation

Validate agent outputs per `checklist.md` "Agent Validation" section. Check expected sections, minimum content length, and reject generic responses.

### Step 3: Verification & Commit

1. Re-run automated checks to confirm fixes
2. Generate smart commit message from branch name + changes
3. For `--scope changed`: auto-commit and exit
4. For `--scope branch`/`all`: create PR

### Step 4: Merge & Deploy (if `--merge`)

1. Push branch, create PR via `gh pr create`
2. Wait for CI (unless `--skip-ci`)
3. Auto-merge via `gh pr merge --squash`
4. If `--deploy`: run `/bs:verify` post-deploy checks
5. On failure + `--auto-rollback`: promote previous deployment

### Step 5: Record Quality History

Update `.qualityrc.json` with run results (score, coverage, duration, cost). Display next-step suggestions.

## Supporting Files

- `reference.md` — Flag definitions, scope options, quality levels, audit mode, teams mode
- `checklist.md` — Exit criteria, agent validation rules, scoring, pattern categories
