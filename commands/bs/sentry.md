---
name: bs:sentry
description: Fleet quality sentry — audits all projects for 8 quality gates, auto-fixes failures, reports summary
argument-hint: '[--audit-only] [--fix] [--json]'
tags: [fleet, quality, sentry, gates]
category: quality
model: sonnet
---

# /bs:sentry - Fleet Quality Sentry

**Arguments received:** $ARGUMENTS

Monitors and enforces quality gates across the entire fleet. Runs automatically monthly via GitHub Actions; use this command for manual runs.

## Flags

| Flag           | Description                                             |
| -------------- | ------------------------------------------------------- |
| `--audit-only` | Report only — no fixes, no PRs                          |
| `--fix`        | Auto-fix projects below 8/8 (default behavior)          |
| `--json`       | Output JSON instead of table                            |
| (default)      | Audit + auto-fix any project below 8/8 + report summary |

## Process

### Step 1: Audit

Run the fleet quality audit:

```bash
bash ~/Projects/claude-setup/scripts/fleet-quality-audit.sh
```

Report the table to the user. If `--audit-only` was passed, stop here.

### Step 2: Identify Failures

For each project below 8/8, identify which gates are failing:

| Gate          | Check                                                  | Fix                                              |
| ------------- | ------------------------------------------------------ | ------------------------------------------------ |
| 1. Knip       | `"dead-code"` in package.json                          | Run bootstrap                                    |
| 2. Patterns   | `"pattern-check"` in package.json                      | Run bootstrap                                    |
| 3. Complexity | `complexity` in eslint config                          | Run bootstrap                                    |
| 4. Imports    | `eslint-plugin-n` in eslint config                     | `npm install -D eslint-plugin-n` + add to config |
| 5. Pre-push   | `.husky/pre-push` exists and non-empty                 | Run bootstrap                                    |
| 6. Pre-commit | `.husky/pre-commit` exists and non-empty               | Run bootstrap                                    |
| 7. Semgrep    | `.semgrep/defensive-patterns.yaml` + `"security:scan"` | Run bootstrap (Gate 7)                           |
| 8. License    | `"license:check"` in package.json                      | Run bootstrap (Gate 8)                           |

### Step 3: Auto-Fix

For each failing project:

1. `cd ~/Projects/<project>`
2. `git checkout main && git pull`
3. `git checkout -b chore/sentry-quality-fix`
4. Run `bash ~/Projects/claude-setup/scripts/bootstrap-ai-gates.sh` for gates 1-3, 5-8
5. For gate 4 (imports): `npm install -D eslint-plugin-n` and add to eslint config
6. Verify fixes: run `npm run lint`, check gate files exist
7. Fix any pre-push hook blockers (npm audit → `--omit=dev`, pattern-check false positives, etc.)
8. Commit: `chore: sentry auto-fix quality gates`
9. Push, create PR, merge
10. Return to main

**Important:** Do NOT use `--no-verify`. Fix blockers, don't skip them.

### Step 4: Verify

Run the audit again to confirm all projects are at 8/8.

### Step 5: Report

Output a summary:

- Projects audited: N
- Perfect (8/8): N/N
- Fixed this run: list of projects + what was fixed
- Still failing: any projects that couldn't be auto-fixed (with reasons)

Store the audit result in `data/fleet-sentry-history.json` for trend tracking.
