# ADR: Bounded AI review contract

## Status

Accepted for BUI-652 after independent high-effort review. Implemented by this change.

## Context

The quality runtime currently turns risk score into a fixed prefix of a six-role Claude panel. The roles share one bounded diff, one provider model, and one base prompt. Majority completion can be recorded as a successful panel, tier-specific focus is not passed to the Claude companion, and structured findings cannot carry reproduction or static-proof evidence. Low-risk provider unavailability can also be represented as a synthetic clean `ci-only` review.

This makes review cost scale mainly with filenames and panel width while overstating the independence and completeness of the resulting evidence. Exact-head identity, signed evidence, deterministic gates, CI freshness, and branch protection are separate strengths and must remain unchanged.

## Decision

1. Resolve AI-review targets to Low `0`, Medium `1`, High `1`, Critical `2`.
2. Select reviewers deterministically from the committed diff domain rather than slicing a fixed prefix. Domain classification is a versioned pure function of the complete changed-file inventory and diff content; it accepts no caller, provider, task-label, or environment input. Stamp/merge recomputes its output from the protected base and PR HEAD. One-review tiers select the first matching eligible specialist in this fixed priority order, otherwise `code-reviewer`:
   1. `security-auditor` — authentication, authorization, credentials, secrets, signing, deployment, hooks, or CI/workflow policy;
   2. `silent-failure-hunter` — shell/runtime lifecycle, installers, retries, concurrency, error handling, or recovery;
   3. `type-design-analyzer` — public API, schema, protocol, serialized data, or type-contract changes;
   4. `performance-engineer` — deterministic performance-domain paths or changed performance primitives;
   5. `pr-test-analyzer` — a Medium test-only change; it is ineligible at High/Critical, where the risk-bearing specialist or reliability backstop wins;
   6. `architect-reviewer` — module-boundary or dependency-graph changes not matched above.

   Specialist matching always evaluates rules 1–6 independently of the unconditional Critical `code-reviewer` slot. A multi-domain Medium/High diff uses the highest-priority matching role. Critical always selects two distinct roles: `code-reviewer` plus the highest-priority matching specialist; a specialist rule may never resolve to `code-reviewer`. When no domain rule matches, `silent-failure-hunter` is the designated reliability backstop. Selection output records distinct rule identities (`reliability-domain` for a real match, `critical-reliability-backstop` for no match) so the result is explainable and fixture-testable. Two is therefore a real Critical floor, not a target that selection may weaken.

   Domain selection is a cost-routing heuristic, not a security boundary or a
   claim that keyword matching recognizes every semantic concern. A disguised
   or novel security flow can fall through to `code-reviewer` at Medium/High;
   deterministic security gates, risk floors, proof requirements, and branch
   protection remain the enforcement layers. The selector must be evaluated
   against confirmed missed-domain escapes and widened when a stable signal is
   demonstrated; it must not pretend to solve general semantic classification.

3. Every selected reviewer must return usable schema-valid evidence. There is no majority quorum.
4. Every exemption and AI-review artifact is signed and bound to contract version, repository, base, from/to HEADs, diff hash, resolved tier, selected roles, selection rule/domain, provider policy, and review-policy digest. The reviewed range must be the complete merge-base-to-current-HEAD diff that the merge would apply; callers cannot supply a narrowed file set, patch, or alternate base. Stamp/merge independently recomputes merge base, changed-file inventory, diff hash, risk tier, reviewer count, selected roles, and selection rule/domain from the protected target branch and PR HEAD and requires exact equality with the evidence. The policy digest is SHA-256 over canonical JSON: object keys sorted recursively; array order preserved because curve and selector priority are semantic; numbers and strings encoded as JSON; no insignificant whitespace. It covers the built-in target curve, effective repository overrides, selector/classifier version, exemption semantics, and proof schema version. Policy drift invalidates completed evidence rather than grandfathering a weaker reviewer set.

   Low risk requires a policy-exemption artifact with `aiReviewRequired: false` rather than a synthetic clean provider verdict. The exemption is mandatory evidence at Low whenever the current admission policy permits it; absent or malformed exemption evidence fails closed. Both recorded and recomputed tiers must be Low. Medium and above reject the exemption regardless of manifest content. Merge authorization may use it only with current deterministic gates, CI, freshness, and branch protection. If signing is unavailable, authorization blocks. If a superseding policy removes or narrows the exemption, the old campaign terminalizes and a new campaign must resolve under the current policy. The existing Low manifest is never mutated or silently degraded.

5. Tier and verification focus are required fields in every provider prompt artifact, including the Claude companion. Prompt construction refuses to invoke a provider when either is absent, and the prompt artifact hash covers both values.
6. Every provider finding includes a concrete failure scenario and a proof object. Proof is one of `reproduction`, `regression-test`, or `static-analysis`, with non-empty evidence. Static-analysis proof must identify changed file and line spans present in the reviewed diff and give a falsifiable input/execution path. The verifier checks span coverage; the judge separately assesses the execution-path reasoning and must record why it is sufficient for BLOCKING or why the finding is downgraded. A schema-valid finding whose reasoning is insufficient remains a preserved `WARNING` with the judge reason; the review is usable and complete, but the warning is not erased or counted as a clean provider finding set. Only zero `BLOCKING` dispositions authorize merge. A finding without structurally valid proof is schema-invalid provider content: it fails the checkpoint, is not silently clean, and is not retryable.
7. One initial review and one post-remediation delta review remain the hard limit. A provider may be retried once only for a typed transport failure, timeout/absent response, or a response that cannot be parsed at all. After that retry, any selected reviewer with no usable response atomically terminalizes the campaign as `provider-incomplete`; parsed but schema-invalid content terminalizes it as `provider-contract-failed`. Either state forbids provider re-entry for that campaign. Evidence reuse requires an exact match on repository, base, from/to HEADs, diff hash, contract version, provider policy, verification focus, and effective review-policy digest; an unchanged HEAD alone is insufficient. Matching evidence is reused, not rerun for a preferable verdict.

The selected review roles are complementary perspectives, not statistically independent votes. Agreement does not promote severity. Critical keeps two roles for domain coverage; cross-provider corroboration may be added later only if the evidence schema can identify both providers without weakening exact-head coverage. The reduction is justified by the verified current implementation using one shared bounded context, one pinned provider model, no tools, and fixed role suffixes; retained telemetry is used only as a cost alarm, not as proof of reviewer accuracy. After deployment, telemetry must report provider execution separately. The weekly quality-value job audits the first 30 Medium+ terminal campaigns, with an interim audit at day 30 and a mandatory available-sample audit at day 90; if fewer than 30 exist, monthly audits continue and are labeled inconclusive. A post-merge defect counts only when its Linear issue or linked fix PR identifies a concrete missed domain and a human or independent review confirms that the omitted specialist was mapped to that domain by this selector. Two confirmed attributable escapes at the same tier trigger rollback of that tier to its version-1 reviewer count until a corrected selector passes protected delivery. Raw heuristic fix-overlap counts do not trigger rollback.

## Alternatives

- **Tests only:** rejected because deterministic gates cannot discover requirements and failure modes they never encoded.
- **Keep the six-role majority panel:** rejected because shared provider context makes the votes correlated and review cost grows without demonstrated additional findings.
- **Require two providers for every Critical change:** deferred because current coverage and signature schemas model one provider checkpoint. Retrofitting overlapping provider coverage in this change would enlarge the authorization surface.
- **Delete path-based risk floors:** rejected because path is the only reliable signal for missing, truncated, or binary patches.

## Invariants

- Deterministic gates, mutation checks, CI, exact-head freshness, signed evidence, merge authority, and branch protection are unchanged.
- Medium and above never receive an AI-review exemption.
- Missing, malformed, incomplete, stale, or unproved evidence required by the resolved contract fails closed. At Low, the required evidence is the signed policy exemption; at Medium and above, it is completed AI-review evidence.
- Preserved `WARNING` and `SUPPRESSED` dispositions remain auditable but do not block merge; authorization requires exactly zero `BLOCKING` dispositions.
- Review-policy digest mismatch is stale evidence. On the next manifest-mutating operation or authorization check, the invocation runtime atomically records terminal state `policy-superseded` and rejects the operation. Terminal historical evidence remains readable but never authorizes a new merge.
- A policy exemption is distinguishable from an AI approval in manifests, telemetry, merge evidence, and signatures.
- Provider output cannot choose its own risk tier, reviewer count, or merge authority.
- Repository configuration cannot weaken the built-in reviewer-count floor for a risk tier.

## Migration and rollback

New campaigns persist `reviewContractVersion: 2` and use the new contract. Existing manifests without that field are version 1: they remain readable and cannot acquire version-2 exemption or proof evidence, while shared verification may enforce a stronger all-selected completion rule. A version-2 manifest cannot be rewritten to version 1.

Rollback means restoring the prior target curve and selector for newly created campaigns while retaining the version-2 reader/verifier. The invocation runtime owns lazy migration: on the next manifest-mutating operation or authorization check it recomputes the current policy digest, atomically terminalizes a non-terminal mismatch as `policy-superseded`, and requires restart. No deploy-time sweep is required. Historical version-2 evidence remains auditable but cannot authorize a new merge after digest drift. Deploying an old binary that cannot read version 2 is not a supported rollback; new-campaign admission must be stopped until a compatibility build is installed.

## Verification

- Public CLI tests prove each tier selects the expected count and domain role.
- Mutation tests show removing a selected reviewer blocks the checkpoint.
- Schema fixtures prove findings without failure scenario or proof are rejected and valid proof survives judge immutability checks.
- Low-risk fixtures prove the signed, exact-head exemption is mandatory, risk is recomputed, tampering fails, and exemption evidence is rejected at Medium/High/Critical; the former synthetic `ci-only` path cannot authorize a version-2 campaign.
- Prompt fixtures prove tier/focus reaches Claude.
- Prompt fixtures prove missing tier or focus blocks provider invocation and both values affect the artifact hash.
- Retry fixtures prove transport/unparseable failures get at most one retry while parsed schema-invalid findings get none.
- Version fixtures prove version-1 campaigns retain old semantics, version-2 campaigns cannot downgrade, and version-2 exemption evidence remains readable after target-curve rollback.
- Configuration fixtures prove repository policy cannot lower the built-in reviewer-count floor.
- Critical no-domain fixtures prove the designated reliability backstop preserves the two-reviewer floor.
- Critical specialist fixtures prove matching is independent of the unconditional `code-reviewer` slot and always yields two distinct roles.
- Policy-digest fixtures prove a historical Low exemption stays readable but cannot authorize after curve, selector, or exemption-policy changes.
- Ordinary AI-evidence fixtures prove policy drift invalidates Medium/High/Critical authorization too.
- Judge fixtures prove insufficient static reasoning is retained as a reasoned WARNING rather than erased or treated as malformed.
- Judge fixtures prove preserved warnings do not block while any blocking disposition does.
- Rollback fixtures prove non-terminal mismatched campaigns become `policy-superseded` and require restart.
- Reuse fixtures prove a changed verification focus invalidates otherwise identical evidence.
- Authorization fixtures prove narrowed file sets, alternate bases, changed from/to heads, or changed diff hashes cannot authorize the complete merge.
- Authorization fixtures prove signed tier, reviewer count, selected roles, and selection rule/domain must exactly match stamp-time recomputation.
- Provider fixtures prove schema-invalid content terminalizes as `provider-contract-failed` and cannot re-enter review.
- Provider fixtures prove one-of-two missing Critical evidence gets one typed retry, then terminalizes as `provider-incomplete` and cannot authorize or re-enter review.
- Existing exact-head coverage, signature, CI, and merge-gate suites remain green.
- Full `scripts/verify` passes before protected delivery.

## Independent review

Passes one through four: BLOCK. Resolved Low exemption integrity, deterministic specialist ordering, retry classification, versioned migration, all-tier policy-digest binding, warning preservation, complete-diff authorization, and rollback state.

Final bounded Opus/high review: **APPROVE**. No blocking or high-severity contract defect remained.
