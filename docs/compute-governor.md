# Compute Governor

Compute Governor gives fresh headless Codex and Claude Code runs one explicit,
provider-neutral execution plan. It selects the lowest approved semantic route
that satisfies both task evidence and a non-lowerable safety floor.

It does not change an interactive session's model. It governs the fresh provider
process used by unattended Ralph runs and can be reused by callers of
`scripts/provider-run.sh`.

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

The result names the route, provider model and effort, enforced wall-time and
worker caps, safety floor, and ordered reasons. Economy routes remain
`candidate-requires-calibration` until a calibration report produces
`eligible-for-default` evidence.

## Launch from facts or a persisted plan

```bash
bash ~/.claude/scripts/provider-run.sh \
  --prompt-file prompt.md \
  --execution-facts facts.json \
  --provider codex \
  --target-dir /path/to/repo \
  --output-dir .claude/run-evidence
```

The runner persists `execution-plan.json` before launch and atomically writes
`run-record.json` after every governed attempt. The record includes
requested/effective identity, timing, attempt count, typed outcome, and nullable
usage; prompt and credential fields are rejected recursively.

Use `--execution-plan plan.json` when a workflow has already persisted and
approved the plan. The runner rejects provider mismatch, policy/model drift, a
route below its safety floor, modified caps, and unknown schema before starting
either provider.

Unattended Ralph uses one durable output directory per issue attempt and passes
conservative `standard` facts because its shell launcher cannot infer repository
blast radius safely. Interactive Ralph may supply more specific facts only with
concrete localization and targeted-proof evidence. Governed plans disable
automatic provider fallback: a new provider requires a new explicit plan and
evidence record.

## Route policy

- `economy-micro`: bounded read-only work with explicit localization.
- `economy-builder`: localized, reversible implementation with targeted proof.
- `standard`: ordinary or insufficiently proven work.
- `expert`: work escalated after two matching failed attempts.
- `critical`: protected surfaces including auth, payments, durable data,
  security, deployment, or public/cross-repository contracts.

Provider model IDs and caps live in `config/compute-governor-policy.json`.
Semantic route names are the stable interface; vendor effort labels are not
treated as equivalents.
