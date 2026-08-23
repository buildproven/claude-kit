# ADR: Recover same-HEAD terminal merge blocks with a signed capability

## Status

Accepted for BUI-795. Implementation must receive a bounded adversarial review
before merge.

## Context

Quality persists one write-once `terminalState` to prevent cleanup and signal
races from relabeling a campaign. That correctly protects completed, stale,
gate-failed, and review-failed outcomes. It also prevents the documented
same-manifest recovery path when an external condition changes after a merge
admission block. In particular, an exact-head Actions billing failure can be
classified later and a signed capability can be attached, but the public runner
returns the cached `blocked` state before it evaluates that capability.

The direct merge phase already validates the signed capability, exact PR/base/
HEAD identity, review coverage, deterministic gates, and merge lease. The
public runner must reach that phase without making ordinary terminal states
re-enterable.

## Decision

Add one recovery transition owned by `quality-invocation.js` and called only by
the public runner before its terminal short-circuit.

The transition is eligible only when all of these conditions hold:

1. The campaign is a merge campaign and its current terminal state is `blocked`.
2. The terminal record is for the current exact HEAD.
3. The terminal record carries a persisted, typed `mergeAdmissionCondition`
   that was written by the merge-admission boundary before it returned its
   block. The condition must be one of the exact condition IDs in the signed
   capability: `ci:failed` for the billing path, or
   `base:protected-nonstrict` and `pr:non-atomic-state` for ref-CAS. Generic
   shell exit text is never an admission predicate.
4. The manifest has a currently valid, exact-identity signed capability with
   either the CI-billing scope or the protected non-strict ref-CAS scope.
5. Exact-head deterministic gate and review evidence remains valid.

On success, append the original terminal record to `terminalHistory` with a
`superseded-by-capability` disposition and a new recovery event that identifies
the signed scope. Replace the active state with a fenced `recovering` sentinel;
do not leave an open terminal slot. The transition increments the manifest's
`terminalEpoch`. Every runner-owned terminal writer carries the epoch it read at
startup, and the recorder rejects a stale epoch. The new runner alone treats a
matching `recovering` sentinel as resumable; all prior runners still short-
circuit on it. The existing deterministic phases reuse exact-head evidence and
then proceed to normal merge authorization. No provider, gate, or review budget
is reset.

All other terminal states remain immutable. Invalid, expired, wrong-PR,
wrong-base, wrong-HEAD, incomplete-condition, gate-failed, review-incomplete,
stale, and merged campaigns refuse recovery.

## Alternatives

### Make every blocked campaign resumable

Rejected. A signed capability for CI cannot authorize a failed test, stale
identity, malformed evidence, or code finding.

### Require a no-op descendant commit

Rejected. It changes PR history solely to work around runtime state and forces
unnecessary gate/review work.

### Call the merge script directly after approval

Rejected as the public recovery contract. It duplicates orchestration routing
at callers and leaves the public runner inconsistent with its documented resume
command.

## Invariants

1. Terminal history is append-only.
2. A terminal write is accepted only for the current terminal epoch. Recovery
   cannot let a pre-recovery writer overwrite its later result.
3. A capability is exact to repository, invocation, PR, base, and HEAD.
4. Recovery cannot mutate or waive existing gate/review evidence.
5. Recovery never resets counters, provider attempts, or active-time budget.
6. Merged, superseded, interrupted, provider-incomplete, provider-contract,
   gate-failed, and identity-failed campaigns do not reopen.
7. The only merge authority remains `quality-stamp-and-merge.sh`.

## Rollback

The transition is additive. A recovered campaign retains its `recovering`
sentinel until a new epoch-bound outcome replaces it, so a rollback restores
the prior runner's terminal short-circuit even if a process stops between
recovery and merge. No existing manifest is rewritten until a signed recovery
is actually used.

## Verification

- A merge-admission block with a valid exact CI-billing capability resumes the
  same manifest and merges without rerunning successful gates or review.
- A valid protected non-strict capability has the same behavior.
- Expired, wrong-identity, incomplete, wrong-scope, non-merge, non-merge-detail,
  gate-failed, provider-incomplete, merged, and stale terminal states remain
  terminal.
- The original terminal record and recovery event persist in `terminalHistory`.
- A stale pre-recovery terminal writer cannot overwrite the recovery result;
  an old runner treats an interrupted recovery as terminal.
