---
name: diagnosing-bugs
description: Disciplined diagnosis loop for hard bugs, regressions, flaky behavior, and performance failures. Use before implementing a fix: create a tight red-capable command, minimize the reproduction, test ranked falsifiable hypotheses, then lock the fix with behavioral evidence.
---

# Diagnosing Bugs

Do not start with a theory. Start with a feedback loop that can prove the
user's exact symptom exists and later prove it is gone.

This workflow is adapted from Matt Pocock's MIT-licensed `diagnosing-bugs`
skill; see `NOTICE`.

## 1. Build one red-capable command

Choose the highest useful public seam:

1. focused existing test or new failing regression test
2. HTTP request or CLI invocation with a fixture
3. browser automation asserting DOM, console, and network behavior
4. captured request/trace replay
5. throwaway harness around the affected module
6. deterministic stress, fuzz, differential, or `git bisect run` harness

The command must:

- exercise the reported code path
- assert the user's exact symptom, not merely “did not crash”
- be deterministic, or raise a flaky reproduction rate enough to investigate
- run unattended and quickly enough for repeated use

Run it and record the command plus failing output. If no red-capable loop can
be built, stop after documenting attempts and request the missing environment,
trace, HAR/log/core dump, or permission for targeted instrumentation.

## 2. Reproduce and minimize

Confirm the loop fails in the way the user reported. Remove inputs, steps,
configuration, callers, and data one at a time, rerunning after each removal.
Stop when every remaining element is necessary to reproduce the failure.

## 3. Rank falsifiable hypotheses

Write 3–5 hypotheses. Each must predict an observable result:

> If X is the cause, changing Y will make the failure disappear or changing Z
> will make it worse.

Rank them by evidence and cost to test. Do not anchor on the first plausible
explanation.

## 4. Probe one variable at a time

Prefer:

1. debugger or REPL inspection
2. targeted boundary instrumentation tied to one hypothesis
3. measurement/profiling for performance regressions

Tag temporary logs with a unique marker such as `[DEBUG-a4f2]`. Never “log
everything and grep.”

## 5. Fix at the correct layer

Before editing, answer the repository's root-cause gate:

- symptom versus cause
- scope across callers/repos
- regression-test prevention
- correct shared/local/upstream layer
- graceful degradation

Turn the minimized reproduction into a behavioral regression test at the
correct seam. Watch it fail, apply the root fix, watch it pass, then rerun the
original unminimized command.

If no stable test seam exists, report that as an architecture finding rather
than adding a misleading shallow test.

## 6. Close cleanly

- original reproduction is green
- regression evidence is green
- full relevant suite is green
- all tagged instrumentation is removed
- throwaway artifacts are removed or clearly quarantined
- commit/PR explains the proven cause, not only the symptom

Only after the fix, recommend architecture work that would prevent recurrence.
