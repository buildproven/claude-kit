---
name: test-strategy
description: Auto-invoke skill for test strategy and coverage guidance. Activates when writing functions, React components, API endpoints, hooks, or utility modules. Provides test pyramid guidance, required test patterns per code type, and coverage threshold enforcement (88%+ target).
context: fork
---

# Test Strategy Skill

## Current Project State

- Test runner: !`node -e "try{const p=require('./package.json');console.log(Object.keys(p.devDependencies||{}).filter(d=>['jest','vitest','mocha','playwright','cypress'].some(t=>d.includes(t))).join(', ')||'none detected')}catch{console.log('no package.json')}" 2>/dev/null`
- Test script: !`node -e "try{console.log(require('./package.json').scripts?.test||'none')}catch{console.log('none')}" 2>/dev/null`

Proactively suggest test cases when writing new code. Target 88%+ coverage across projects.

## When This Activates

- Writing a new function or module
- Creating a React component
- Building an API endpoint or route handler
- Implementing a custom hook
- Writing utility/helper functions

## Test Pyramid (Priority Order)

1. **Unit tests** (70%) - Fast, isolated, test one thing
2. **Integration tests** (20%) - Test module boundaries and data flow
3. **E2E tests** (10%) - Critical user paths only

## Required Test Patterns by Code Type

### React Component

```
- Renders without crashing (smoke test)
- Renders correct output for given props
- User interactions trigger expected behavior (click, type, submit)
- Conditional rendering works (loading, error, empty states)
- Accessibility: focusable, labeled, keyboard navigable
```

### API Endpoint / Route Handler

```
- Happy path returns expected status + shape
- Authentication: rejects unauthenticated requests (401)
- Authorization: rejects unauthorized requests (403)
- Validation: rejects malformed input (400) with clear error
- Not found: returns 404 for missing resources
- Error handling: returns 500 with safe error message (no stack traces)
```

### Utility / Pure Function

```
- Normal inputs produce expected outputs
- Boundary values (0, empty string, null, undefined, MAX_SAFE_INTEGER)
- Invalid inputs throw or return error (not silent failure)
- Type coercion edge cases if applicable
```

### Custom Hook

```
- Returns expected initial state
- State transitions work correctly
- Cleanup runs on unmount
- Re-renders with new deps produce correct state
- Error states are handled
```

### Async Operations

```
- Resolves with expected data
- Rejects/throws on failure with meaningful error
- Loading states transition correctly
- Cancellation/cleanup on unmount
- Retry logic (if applicable)
```

## Test File Location

Match project conventions. Common patterns:

- `__tests__/ComponentName.test.tsx` (colocated)
- `src/components/ComponentName/ComponentName.test.tsx` (nested)
- `tests/unit/module.test.ts` (separate directory)

Check existing tests in the project first and follow the same pattern.

## Coverage Enforcement

- Target: 88%+ line coverage
- New code should not decrease overall coverage
- Critical paths (auth, payments, data mutations) require 95%+
- Use `/* istanbul ignore next */` only for truly unreachable code, with a comment explaining why

## What to Suggest

When you see new code being written, proactively suggest:

1. The specific test file to create (path based on project conventions)
2. Test cases organized by the patterns above
3. Any mocks/fixtures needed
4. Which testing library to use (match project: vitest, jest, testing-library, etc.)

Keep suggestions concise - list test cases as bullet points, don't write full test implementations unless asked.
