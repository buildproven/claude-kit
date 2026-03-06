# Quality Checklist — Exit Criteria & Agent Validation

## Level 95 Exit Criteria

- [ ] Tests: Changed files passing (CI runs full suite)
- [ ] ESLint: 0 errors, 0 warnings
- [ ] TypeScript: strict mode, no `any`, 0 errors
- [ ] Build: successful with 0 errors
- [ ] No silent failures (empty catches, swallowed errors)
- [ ] No type safety issues (proper types, no assertions)
- [ ] Security: No secrets exposed, no critical OWASP issues, dependency audit
- [ ] Test coverage: Changed code files have corresponding test updates
- [ ] Test quality: Tests validated for meaningful coverage (not trivial)
- [ ] Documentation: Help/README updated if commands/API changed

## Level 98 Exit Criteria (beyond 95%)

- [ ] Accessibility: WCAG 2.1 AA compliant
- [ ] Performance: Lighthouse > 90, Core Web Vitals green
- [ ] Architecture: No tech debt, scalable patterns
- [ ] Code simplification: No unnecessary complexity
- [ ] BACKLOG.md: Item marked complete (if branch references backlog ID)

## Agent Validation (CS-079)

### Expected Sections by Agent

| Agent                 | Required Sections                                    |
| --------------------- | ---------------------------------------------------- |
| code-reviewer         | findings, summary, severity_breakdown                |
| silent-failure-hunter | findings, patterns_checked, risk_level               |
| type-design-analyzer  | findings, type_coverage, any_usage_count             |
| security-auditor      | findings, vulnerabilities, secrets_scan, owasp_check |
| test-analyzer         | findings, coverage_gaps, test_quality_score          |
| accessibility-tester  | findings, wcag_violations, a11y_score                |
| performance-engineer  | findings, lighthouse_scores, web_vitals              |
| architect-reviewer    | findings, pattern_violations, tech_debt_items        |
| code-simplifier       | findings, complexity_reduced, files_simplified       |

### Minimum Content Length

- code-reviewer: 50 chars
- security-auditor: 50 chars
- performance-engineer: 50 chars
- architect-reviewer: 50 chars
- All others: 30 chars

### Generic Phrases (reject when used alone)

- "No issues found"
- "All checks passed"
- "Everything looks good"
- "No problems detected"
- "Code is clean"
- "LGTM"

### Validation Logic

1. Check expected sections exist in output
2. Verify minimum content length
3. Flag generic phrases without substantive context
4. Verify findings have file:line references
5. Validate JSON is well-formed
6. Retry failed agents once; if still failing, mark as failed

## Audit Scoring (--audit mode)

Score starts at 100, deductions:

| Category | Check              | Deduction |
| -------- | ------------------ | --------- |
| Code     | Tests fail         | -30       |
| Code     | Lint errors        | -15       |
| Code     | Type errors        | -15       |
| Code     | Build fails        | -30       |
| Security | npm audit critical | -25       |
| Security | Hardcoded secrets  | -30       |
| Docs     | No README          | -10       |
| Docs     | No ARCHITECTURE.md | -5        |
| Deploy   | No deploy config   | -5        |
| Deploy   | No .env.example    | -3        |
| Deploy   | No CI workflow     | -5        |

### Score Thresholds

- > =90: READY TO SHIP
- > =70: ALMOST READY
- > =50: NEEDS WORK
- <50: NOT READY

## Test Quality Validation

### Red Flags in Generated Tests

- Tests that only check "renders without crashing"
- Assertions that don't test behavior (e.g., `expect(true).toBe(true)`)
- Missing edge case coverage
- No error path testing
- Snapshot-only tests without behavioral assertions

### Minimum Test Requirements

- Each code file should have corresponding test file
- Tests should cover main functionality + at least 2 edge cases
- Error paths must be tested (invalid input, network failures)
- Test descriptions should explain the scenario, not repeat code
