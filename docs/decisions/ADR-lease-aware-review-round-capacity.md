# ADR: Lease-aware review-round authorization and phase capacity

## Status

Accepted for BUI-684.

## Context

Merge campaigns persist an invocation manifest under a repository-scoped
fencing lease. Every mutation of that manifest must present the lease token.
The documented quality sequence currently invokes `quality-run-governor.js
bump-round` before the review runner. That command persists review-round
authorization but runs in a fresh process without pinning the manifest lease,
while the later review runner does pin it. A failed authorization can therefore
be followed by provider work whose artifact cannot be recorded.

The same campaign has one global provider-start cap. A discovery primary that
falls back consumes both starts. After the one permitted remediation commit,
the mandatory exact-head verification cannot start even though its review time
was reserved. Raising the global cap would allow discovery retries to consume
verification capacity and would weaken the bounded campaign contract.

## Decision

Expose a single public `authorize-review-round` command in the quality runtime.
For a merge manifest it pins and verifies the repository lease, then invokes
the existing governor `bump-round`; non-merge manifests retain the governor's
current behavior. The documented skill calls this command and exits immediately
when it fails. Provider dispatch remains prohibited unless the persisted
authorization exists.

Persist a phase-aware provider-attempt plan when risk resolution fixes the
runtime plan. It contains a
bounded allowance for each of the two possible review rounds: discovery and
post-remediation verification. The allowance is derived from the selected
provider policy and planned provider passes, not an unqualified global number.
Each provider start is charged to the current authorized round. A start may use
only that round's allowance; unused verification capacity cannot start further
discovery work, and a verification round cannot exist without a changed exact
head and the existing round authorization.

The existing total provider-seconds budget, one-remediation limit, two-review
round limit, exact-head evidence checks, and fail-closed provider failure
behavior remain authoritative.

## Alternatives considered

1. Pin the lease in `SKILL.md` before calling `bump-round`. Rejected: it leaves
   every programmatic caller responsible for a security-sensitive prerequisite
   and makes the public governor command unsafe for merge manifests.
2. Raise `maxProviderAttempts` from two to four. Rejected: discovery can spend
   the verification reserve, so a mandatory review is still not guaranteed.
3. Reuse first-round evidence after remediation. Rejected: it cannot prove the
   changed exact head and violates the mandatory verification requirement.

## Invariants

- A merge-manifest review authorization is persisted only under a currently
  verified repository lease token.
- No provider process starts after an authorization failure.
- Discovery and verification provider allowances are explicit, bounded, and
  non-borrowable.
- Verification is still exact-head-bound and begins only after the existing
  remediation/advance transition authorizes round two.
- Legacy sentinel governor behavior remains available for non-manifest tests
  and compatibility callers.

## Rollback

The new command and phase-plan fields are additive. A rollback can restore the
global ledger only after marking merge campaigns that lack phase-plan data as
ineligible for post-remediation verification; it must not silently grant a
third discovery attempt. Existing manifests remain fail-closed if their state
cannot be interpreted.

## Verification

- Fresh-shell integration tests prove the documented merge sequence pins the
  lease before persisting a round.
- Missing and stale lease tests prove no authorization or provider launch.
- A primary-plus-fallback discovery followed by one remediation proves the
  verification start is available only in the second round.
- Exhaustion tests prove neither phase can spend the other's allowance.
- Focused runtime tests and the full repository verification gate pass.
