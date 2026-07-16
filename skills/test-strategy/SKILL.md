---
name: test-strategy
description: Auto-invoke skill for behavioral test strategy. Activates when changing functions, components, APIs, workflows, or shared modules. Chooses the highest useful public interface and seam, requires red-capable tests with independent expected values, and avoids implementation-coupled file-per-source coverage.
context: fork
user-invocable: false
---

# Behavioral Test Strategy

## Current Project State

- Test runner: !`node -e "try{const p=require('./package.json');console.log(Object.keys(p.devDependencies||{}).filter(d=>['jest','vitest','mocha','playwright','cypress'].some(t=>d.includes(t))).join(', ')||'none detected')}catch{console.log('no package.json')}" 2>/dev/null`
- Test script: !`node -e "try{console.log(require('./package.json').scripts?.test||'none')}catch{console.log('none')}" 2>/dev/null`

Test observable behavior through stable public interfaces. Coverage percentages
and test-file counts are signals, not the goal.

## When This Activates

- Writing a new function or module
- Creating a React component
- Building an API endpoint or route handler
- Implementing a custom hook
- Writing utility/helper functions

## Choose the seam first

Before writing a test, name:

- **Behavior** — what a user or caller can observe
- **Public interface** — the supported way they exercise it
- **Seam** — the highest stable interface where the behavior is deterministic
- **Oracle** — the independent source of the expected result

Prefer the highest seam that is still fast and deterministic:

1. Existing integration/module interface
2. HTTP/CLI/public package interface
3. Browser flow for critical user behavior
4. Unit-level seam only when the logic is genuinely isolated

Do not create a seam solely for mocking. One adapter is usually a hypothetical
abstraction; introduce a seam when behavior actually varies or needs isolation.

## Red-capable evidence

A useful test must:

- fail on the behavior being added or fixed
- fail for the intended reason, not setup/import errors
- run deterministically and quickly enough for repeated use
- survive internal refactors while the public behavior stays the same
- use expected values from a spec, fixture, worked example, or known-good
  system—not the same calculation as production code

For bugs, turn the minimized reproduction into the regression test whenever the
correct seam exists.

## Behavior checklist

Choose only relevant cases:

- primary success path
- boundary and empty states
- validation/authentication/authorization failures
- timeout, retry, cancellation, or partial failure
- loading, empty, error, disabled, focus, and recovery states for UI
- concurrency or idempotency where the interface permits repeats
- accessibility behavior at the user-facing seam

## Anti-patterns

- one test file per source file as a blanket rule
- testing private methods or internal collaborator calls
- snapshots as the only assertion
- “renders without crashing” as meaningful coverage
- tautological expectations that duplicate production logic
- mocking the module under test instead of exercising its interface
- broad end-to-end tests when a faster public seam proves the same behavior

## Placement and verification

Match project conventions. Common patterns:

- `__tests__/ComponentName.test.tsx` (colocated)
- `src/components/ComponentName/ComponentName.test.tsx` (nested)
- `tests/unit/module.test.ts` (separate directory)

Check existing tests in the project first and follow the same pattern.

Report:

1. the chosen seam and why it is stable
2. the exact red-capable command
3. the behavioral cases added or updated
4. focused-test and full-suite results

Concepts in this skill are adapted from Matt Pocock's MIT-licensed `tdd` and
`diagnosing-bugs` skills; see `NOTICE`.
