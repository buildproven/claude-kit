# ADR: Provider-neutral Compute Governor

## Decision

`compute-governor.js` owns deterministic selection of a semantic execution
route. `provider-run.sh` owns the fresh provider process and accepts a validated
execution plan through `--execution-plan`. Neither a workflow nor an adapter
may silently inherit the interactive session model or effort for a governed
run.

The plan has two independent inputs: a protected-surface safety floor and work
difficulty. Difficulty can choose a more expensive route but never lower the
floor. Economy routes are candidates until calibration proves their acceptance
and retry outcomes meet the declared baseline.

## Consequences

- Policy maps semantic routes to vendor-specific models and efforts.
- Codex plans use explicit `--model` and `model_reasoning_effort`; Claude plans
  use explicit `--model` and `--effort` where available.
- Evidence is local and redacted: it records plan, effective settings, outcome,
  and nullable usage, but not prompts or credentials.
- Existing quality routing remains unchanged until separately migrated with its
  exact-head evidence contract.

## Verification

- `scripts/__tests__/compute-governor.test.js`
- `scripts/__tests__/provider-native.test.js`
- `node scripts/compute-governor.js explain <facts.json>`
