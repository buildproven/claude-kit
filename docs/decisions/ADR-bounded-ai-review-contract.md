# ADR: Signed AI lead discovery, deterministic merge authority

## Status

Accepted for BUI-652/BUI-657 through BUI-661. Implementation is complete only
when the protected change passes every verification item below. This decision
supersedes the model-judged blocking-review contract in earlier commits on this
branch.

## Context

The former quality runtime treated several correlated model invocations as a
merge verdict. The roles shared one diff, prompt shape, pinned model, and
tool-less execution. Majority completion, prose severity, and a second model
judge overstated the independence and meaning of that evidence. Provider
failure at Low could also be serialized as a synthetic clean `ci-only` review.

AI review is useful stochastic defect discovery, but it is not proof that a
change is correct. SWR-Bench reports substantial run-to-run variation and low
precision for current automated review systems. Research on intrinsic
self-correction likewise shows that another model opinion is not a reliable
substitute for external feedback.

An attempted design on this branch added a fresh settlement model. Independent
architecture review found that a semantic `REFUTED` outcome still depended on
model prose. Hashing an unrelated passing test cannot prove that the test covers
the claimed execution path. Making `UNRESOLVED` block would preserve the false-
positive availability problem; letting it merge would recreate a hidden
warning loophole. The general settlement layer therefore cannot be both
automatic and mechanically sound.

Primary evidence:

- [SWR-Bench, arXiv:2509.01494](https://arxiv.org/abs/2509.01494)
- [Large Language Models Cannot Self-Correct Reasoning Yet, ICLR 2024](https://openreview.net/forum?id=IkmD3fKBPQ)
- [Can Large Language Models Really Improve by Self-critiquing Their Own Plans?, ICLR 2025](https://openreview.net/forum?id=4O0v4s3IzY)

## Decision

### 1. Trust boundary

AI output is a set of review leads, never a merge verdict. Detector severity,
agreement, absence of leads, provider availability, and model-authored
settlement do not authorize or block a merge.

Merge authority remains deterministic gates, CI, exact-head freshness, signed
evidence, mutation checks, and branch protection. A lead becomes blocking only
when converted into deterministic evidence that already participates in those
gates: a reproducible failing command from the repository's allowlisted gate
contract, a regression test, or an auditable static rule executed by the
runtime. The model may propose that conversion but cannot attest that it ran.

The signed trailer distinguishes:

- `Quality-Leads`: raw AI leads produced for the exact HEAD;
- `Quality-Review-Status`: `complete`, `incomplete`, or `policy-exempt`;
- `Quality-Findings`: deterministic unresolved failures, which remains the
  existing merge-blocking count.

No unavailable or incomplete AI run is represented as clean. It is signed as
`incomplete`; because AI is advisory, it does not gain merge authority by being
complete and does not remove deterministic merge authority by being
unavailable.

### 2. Discovery depth and selection

Targets are Low `0`, Medium `1`, High `1`, Critical `2`. Counts and deterministic
domain selection deploy atomically. Repository configuration cannot change
these built-in score-band targets; a differing curve is rejected as visible
policy drift.

Low performs no provider invocation and records a signed exact-head
`policy-exempt` attestation. Medium and High select one domain-appropriate role
from the complete committed diff. Critical selects a general reviewer and a
distinct specialist or reliability backstop.

Critical attempts provider/model-family diversity when the configured providers
support it and records the effective identity per slot. A bounded
single-provider fallback can complete with one model family when every selected
role returns usable evidence; it does not claim model-family independence. This
availability behavior is safe because the AI status has no merge authority.

Domain selection is a versioned cost-routing heuristic, not a security
boundary. It consumes the complete changed-file inventory and diff content,
accepts no caller-supplied narrowing, and is recomputed during stamping. Stable
path evidence remains a fallback when content is missing, truncated, or binary.

### 3. Completion and retries

Every selected slot either returns schema-valid evidence or records a typed
incomplete state. There is no majority quorum, severity promotion, vote, or
model judge.

Each slot gets one initial attempt and at most one replacement with a different
provider for rc `2` (unavailable), `75` (quota), `76` (timeout), `77` (governor
declined before launch), `79` (billing), or rc `4` when no schema-valid object
could be extracted. Parsed schema-invalid content is not retried. Attempt and
wall-clock caps remain finite and manifest-bound.

The legacy `ci-only` synthetic-clean execution path is unreachable for version
2 and retained only by the historical version-1 reader until migration deletes
that reader. Version 2 cannot create or authorize it. The correlated
adversarial-vote script is deleted. Low never calls a provider, so there is no
Low provider-failure exception to preserve.

### 4. Leads and remediation

Each lead carries its detector identity, changed file and line, concrete failure
scenario, and proposed verification path. The signed artifact inventory binds
the immutable source artifact hash. All leads are preserved as a union.
Agreement, intersection, frequency, or another model's opinion does not
suppress or promote them.

The delivery agent reads each lead as a hypothesis, reproduces or refutes it
against source and deterministic execution, and may make one batched fix commit.
Any fix changes HEAD and therefore requires a delta discovery attestation. The
hard limit remains one initial round, at most one batched fix, and one delta
round. After that, remaining decisions require the existing signed operator
override; the evidence is not rewritten as clean.

### 5. Authorization and evidence

Signed evidence binds contract version, repository, protected base, reviewed
HEAD, complete diff hash, risk tier, policy digest, selected slots, effective
provider/model identities, prompt/focus hashes, discovery artifacts, lead count,
review status, deterministic gates, and mutation evidence.

Authorization requires deterministic gates and CI green, exact-head freshness,
current signed evidence, and branch protection. It does not require zero AI
leads or a model clean verdict. `Quality-Findings == 0` continues to mean zero
deterministic unresolved failures, never zero model suggestions.

## Ordering

The executable contract ships atomically within one protected change:

1. lead/status evidence fields and authorization semantics;
2. domain selection and `0/1/1/2` targets;
3. removal of judge, majority, agreement promotion, and synthetic clean paths;
4. typed incomplete states and bounded replacement;
5. prompt/focus/model identity propagation;
6. telemetry terminology and attribution.

Counts must not deploy before the advisory authorization boundary. Reducing
discovery while an old model verdict still authorizes merges is a fail-open.
Risk-score path/content refinement follows telemetry because it has the highest
classification regression risk.

## Invariants

- Exact-head binding, signing, CI, mutation checks, and branch protection are
  never weakened.
- AI completion, absence, severity, or agreement never changes merge authority.
- Missing AI evidence is called `incomplete`, never clean or passed.
- Provider output cannot choose risk tier, reviewer count, merge authority, or
  its evidence identity.
- No free-form model command is executed.
- Historical evidence remains readable but policy drift cannot authorize a new
  merge.

## Verification

- Tier fixtures prove `0/1/1/2`, atomic selection, and rejection of lowered
  repository targets.
- Low fixtures prove no provider invocation and no `ci-only` artifact or signer.
- Completion fixtures prove every selected slot is accounted for and retry
  categories are bounded.
- Lead fixtures prove union preservation, immutable identity, and no
  agreement-based promotion or suppression.
- Authorization fixtures prove AI leads and incomplete AI status cannot bypass
  or veto deterministic gates.
- Tamper fixtures prove missing, altered, stale, or narrowed evidence cannot
  authorize.
- Full tests, lint, formatting, security, license, mutation, exact-head review,
  protected CI, and merge gates pass before delivery.

## Measurement and rollback

Telemetry records every terminal campaign with discovery status, provider time,
gate time, slot identities, lead count, deterministic finding count, and merge
result. It does not label heuristic ratios as precision.

After 20 Medium+ campaigns, evaluate median campaign time, terminal telemetry
coverage, leads converted to deterministic failures, attributable escaped
defects, and defects in the quality machinery. If discovery does not justify its
cost, remove AI from the required campaign entirely and retain it as an optional
developer aid. This rollback cannot weaken deterministic merge authority.
