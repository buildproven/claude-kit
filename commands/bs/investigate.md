---
name: bs:investigate
standalone: true
description: Root-cause debugging — find the actual cause before touching any code
argument-hint: "<error or symptom> → systematic 4-phase investigation"
tags: [debug, investigate, root-cause]
category: utility
---

# /bs:investigate — Root Cause First

<!-- Inspired by gstack/investigate (MIT) — adapted to bs conventions -->

**The Iron Law: No fixes without root cause investigation first.**

Fixing symptoms creates whack-a-mole debugging. This command forces you to trace the actual problem before touching a single line of code.

Use `/bs:dev` when you're stuck mid-implementation. Use `/bs:investigate` when something is broken and you need to understand _why_ before doing anything.

## Phase 1 — Gather & Reproduce

1. Read the exact error message, stack trace, or symptom in full
2. Check recent git log for changes in the affected area: `git log --oneline -20 -- <path>`
3. Reproduce the failure deterministically — if you can't reproduce it, stop and say so
4. Read ALL code in the call path. Don't skim.

## Phase 2 — Pattern Match

Before forming hypotheses, check against known bug signatures:

- **Race condition** — timing-dependent, passes locally, fails in CI
- **Nil/null propagation** — works with real data, fails on edge cases
- **State corruption** — works first run, fails on second
- **Config mismatch** — works in one env, fails in another
- **Stale cache / build artifact** — try a clean build first
- **Path/import error** — file moved, renamed, or deleted

## Phase 3 — Hypotheses & Testing

1. List every plausible root cause (H1, H2, H3...)
2. Order by likelihood — start with the simplest
3. Test each hypothesis with a minimal, targeted check (add logging, read a value, trace the path)
4. **3-strike rule**: If 3 hypotheses fail, stop. Do not guess a 4th. Escalate to `/bs:strategy --mode debate` or write a minimal reproducer.

## Phase 4 — Fix & Verify

Only proceed here after root cause is confirmed:

1. Fix the root cause — not the symptom
2. Write a regression test that fails without the fix and passes with it
3. **Large diff gate**: If the fix touches >5 files, confirm with the user before committing
4. Verify the original symptom is gone

## Scope Lock

While investigating, restrict edits to the affected module only. No opportunistic cleanup, no related fixes. One root cause, one fix, one commit.

## Output

When done, produce a structured report:

```
## Debug Report

**Symptom**: [what was observed]
**Root cause**: [the actual problem, with file:line]
**Fix**: [what changed and why]
**Evidence**: [how root cause was confirmed]
**Regression test**: [test name / location]
**Status**: DONE | DONE_WITH_CONCERNS | BLOCKED
```

If BLOCKED, explain exactly what information is needed to proceed.
