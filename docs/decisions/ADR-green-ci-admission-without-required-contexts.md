# ADR: Reuse green CI when no check is marked required

## Status

Accepted for implementation, 2026-08-13.

## Context

The quality merger asks GitHub only for branch-rule-required checks before the
fleet Actions-minute admission gate. On a private repository whose plan cannot
mark a registered workflow as required, GitHub CLI explicitly reports that no
required checks exist even when the exact PR head has a successful Actions
check. The merger then
treats that candidate as new CI spend and blocks it at the fleet hard limit.
Later in the same workflow, `quality-wait-required-checks.sh` already handles
this repository class by waiting on every registered check.

## Decision

Keep required checks authoritative whenever GitHub returns at least one. Only
when GitHub CLI explicitly reports `no required checks reported`, inspect every
registered PR check and classify the exact head as already green when the set
is non-empty and every check is `SUCCESS`, `SKIPPED`, or `NEUTRAL`. Other
required-check lookup failures remain non-green and retain normal CI-budget
admission.

This changes only CI-budget admission. It does not waive review evidence,
base freshness, merge authorization, or the later exact-head CI waiter.

## Alternatives

- Always invoke the minute-policy gate: rejected because it blocks reuse of CI
  that has already run and cannot spend another minute.
- Treat an empty required set as green: rejected because a candidate with no
  registered CI would bypass evidence.
- Disable the fleet minute policy per invocation: rejected because it bypasses
  the control rather than correcting its evidence classification.

## Invariants and rollback

- A non-empty required set is never replaced by the broader registered set.
- An empty registered set is never green.
- Any failing, pending, or unknown state remains non-green.
- An API, authentication, or unexpected CLI failure never activates fallback.
- Rollback is a one-commit revert; no durable data or schema changes exist.

## Verification

Pin the required-set-first ordering and registered-check fallback in the merge
gate test, run the focused quality tests, then run the repository quality
workflow before merge.

The required high-effort adversarial review found no objection to this
decision or its invariants. Its only finding was that the deliberately red
regression test preceded the production implementation; implementation may
therefore proceed against that failing test.
