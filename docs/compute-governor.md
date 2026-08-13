# Compute Governor

Compute Governor gives fresh headless Codex and Claude Code runs one explicit,
provider-neutral execution plan. It selects the lowest approved semantic route
that satisfies both the task evidence and a non-lowerable safety floor.

It does not change an interactive session's model. It currently governs the
fresh provider process used by unattended Ralph runs and can be reused by any
caller of `scripts/provider-run.sh`.

## Explain a route without launching a provider

Create a facts file:

```json
{
  "provider": "codex",
  "phase": "implement",
  "localized": true,
  "reversible": true,
  "targetedProof": true,
  "changedFiles": 1,
  "protectedSurfaces": [],
  "sameFailureStreak": 0
}
```

Then inspect the deterministic plan:

```bash
node ~/.claude/scripts/compute-governor.js explain facts.json
```

The result names the semantic route, exact provider model and effort, enforced
wall-time and worker caps, safety floor, and ordered reasons. Economy routes
remain labelled `candidate-requires-calibration`; the calibration command must
produce `eligible-for-default` evidence before an operator makes one a default
for a task class.

## Launch from facts or an already-persisted plan

```bash
bash ~/.claude/scripts/provider-run.sh \
  --prompt-file prompt.md \
  --execution-facts facts.json \
  --provider codex \
  --target-dir /path/to/repo \
  --output-dir .claude/run-evidence
```

The runner persists `execution-plan.json` before launch and atomically writes
`run-record.json` after every governed attempt. The record includes requested/effective model
identity, timing, attempt count, typed outcome, and nullable usage. It rejects
prompt or credential fields recursively.

Every plan embeds only the allowlisted execution facts used to resolve it.
Validation recomputes the complete plan from those facts and the installed
policy, so a caller cannot lower a protected-surface floor by editing the plan.
Unknown fact fields—including prompts and credentials—are rejected.

Use `--execution-plan plan.json` when a workflow has already persisted and
approved the plan. The runner rejects a provider mismatch, policy/model drift,
a route below its declared safety floor, modified caps, or an unknown schema
before starting either provider.

Unattended Ralph uses one durable output directory per issue attempt so the
resolved plan, provider output, and terminal record survive success and failure.
Because its shell launcher cannot safely infer repository blast radius, that
launcher supplies conservative `standard` facts. Interactive Ralph may supply
more specific facts only when it has concrete localization and targeted-proof
evidence. Governed plans intentionally disable automatic provider fallback; a
new provider requires a new explicit plan and evidence record.

## Route policy

- `economy-micro`: bounded read-only work with explicit localization.
- `economy-builder`: localized, reversible implementation with targeted
  deterministic proof and no unresolved same-class failure.
- `standard`: ordinary or insufficiently proven work.
- `expert`: work escalated after two matching failed attempts.
- `critical`: protected surfaces such as auth, payments, durable data,
  security, deployment, or a public/cross-repository contract.

Provider model IDs and caps live in
`config/compute-governor-policy.json`. Semantic route names are the stable
interface; vendor effort labels are not treated as equivalents.
