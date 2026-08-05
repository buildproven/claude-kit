# Quality Checklist — Exit Criteria & Agent Validation

## Tier-aware Exit Criteria (level auto)

Review depth scales with the resolved risk tier (see `reference.md` §Quality Levels). The configured primary can be Claude or Codex; fallback is availability-only. Other gates apply at every tier.

| Gate                                        | low | medium | high | critical |
| ------------------------------------------- | --- | ------ | ---- | -------- |
| Behavioral test evidence + suite passes     | ✓   | ✓      | ✓    | ✓        |
| ESLint / TypeScript / build clean           | ✓   | ✓      | ✓    | ✓        |
| Defensive pattern analysis                  | ✓   | ✓      | ✓    | ✓        |
| Signed exact-head policy exemption          | ✓   |        |      |          |
| Domain-selected AI reviewers                | 0   | 1      | 1    | 2        |
| Every selected reviewer is accounted for    |     | ✓      | ✓    | ✓        |
| AI lead/status evidence is signed           |     | ✓      | ✓    | ✓        |
| `Reviewed-By: quality` signed authorization | ✓   | ✓      | ✓    | ✓        |

## Level 95 Exit Criteria (legacy, full panel)

- [ ] **Tests pass**: `npm test` exits 0 (HARD GATE — blocks everything)
- [ ] **Behavior is tested**: Changed behavior has evidence at the highest useful public seam; file-per-source tests are not required
- [ ] **Changed tests pass**: Any tests added during fixes must pass before continuing
- [ ] ESLint: 0 errors, 0 warnings
- [ ] TypeScript: strict mode, no `any`, 0 errors
- [ ] Build: successful with 0 errors
- [ ] No silent failures (empty catches, swallowed errors)
- [ ] No type safety issues (proper types, no assertions)
- [ ] Security: No secrets exposed, no critical OWASP issues, dependency audit
- [ ] Test quality: Tests validated for meaningful coverage (not trivial)
- [ ] AI leads: verified against source and deterministic repository evidence
- [ ] Documentation: Help/README updated if commands/API changed

## Level 98 Exit Criteria (beyond 95%)

- [ ] Accessibility: WCAG 2.1 AA compliant
- [ ] Performance: Lighthouse > 90, Core Web Vitals green
- [ ] Architecture: No tech debt, scalable patterns
- [ ] Code simplification: No unnecessary complexity
- [ ] Linear: Mark issue Done via mcp**linear**update_issue (if branch references PROJ-123)

## Agent Validation (CS-079)

### Expected Sections by Agent

| Agent                 | Required Sections                                    |
| --------------------- | ---------------------------------------------------- |
| code-reviewer         | findings, summary, severity_breakdown                |
| silent-failure-hunter | findings, patterns_checked, risk_level               |
| type-design-analyzer  | findings, type_coverage, any_usage_count             |
| security-auditor      | findings, vulnerabilities, secrets_scan, owasp_check |
| pr-test-analyzer      | findings, coverage_gaps, test_quality_score          |
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

## AI Lead Validation

- Reviewer agreement does not promote severity. Roles that share a model,
  context, or provider are complementary coverage, not independent votes.
- Detector severity is advisory. Every lead must include a changed file and
  line, an expected-versus-actual failure scenario, and a proposed deterministic
  verification path.
- A lead blocks only after conversion into a failing allowlisted gate,
  regression test, or executable static rule.

### Suppression Rules (NEVER report these)

- Import ordering suggestions
- Variable naming preferences (unless misleading)
- "Consider using X pattern" without a concrete bug
- Comments about unchanged code
- Suggestions that increase complexity without fixing a bug
- "LGTM" or "no issues found" padding

### Output Requirements

- Signed evidence includes lead count, source attribution, review status, and
  files reviewed.
- Every lead remains auditable even when refuted or unproved.
- Empty discovery means only that the bounded run emitted no leads; it is not a
  correctness claim.

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

- Changed behavior is exercised through a public interface
- The test would fail if the behavior regressed
- Expected values come from an independent source of truth
- Relevant failure/recovery paths are covered
- Test descriptions explain the scenario, not the implementation
