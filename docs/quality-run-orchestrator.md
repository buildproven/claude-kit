# Deterministic Quality-Run Orchestrator

## Decision

Replace the model-sequenced portions of the quality workflow with one
deterministic runner. The runner owns target bootstrap, risk selection, gates,
review dispatch, authorization, merge, cleanup, and terminal telemetry. A
model is used only where judgment is the product: classifying identity-checked
findings and choosing a remediation patch.

This design is implemented by `scripts/quality-run.js` for BUI-791. The
existing manifest and individual scripts remain the compatibility boundary;
the public runner now owns their order, resume rules, and typed outcome.

## Contract

`quality-run` receives exactly one of two inputs:

- a new, validated quality invocation; or
- `--manifest <exact-path>` to resume that exact campaign.

It never discovers a campaign by session, glob, timestamp, environment
inheritance, or a “latest” pointer. The manifest is the complete state machine
and every phase records an identity-bound result before the next one begins.

```
bootstrap → policy → gates → review → judge → [remediate → gates → verify] → authorize/merge → telemetry
```

Terminal outcomes are `merged`, `reviewed`, `blocked`, and `failed`. Cleanup
and telemetry run from a `finally` path and cannot convert a successful merge
into a failure or an invalid campaign into success.

## Phase ownership

| Phase     | Deterministic runner responsibility                                                 | Model responsibility                                                    |
| --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Bootstrap | Resolve the exact target, create/advance manifest, acquire worktree ownership       | None                                                                    |
| Policy    | Resolve risk, provider policy, deadline, and immutable required gates               | None                                                                    |
| Gates     | Execute revision-bound argv gates and persist results                               | None                                                                    |
| Review    | Enforce governor budget, dispatch provider, validate artifact identity              | None                                                                    |
| Judge     | Construct the complete identity-bound findings input and validate every disposition | Classify each finding as blocking, warning, or suppressed with a reason |
| Remediate | Verify the governor allows one fix round; advance manifest after a commit           | Produce the bounded patch and explain unresolved findings               |
| Merge     | Verify coverage, CI, authorization, and merge; perform worktree-aware cleanup       | None                                                                    |
| Telemetry | Write exactly one terminal record                                                   | None                                                                    |

The runner must fail closed when state is unreadable, a phase result does not
match the current revision, a provider result is malformed, or a model omits a
required finding disposition.

## Migration plan

1. **Complete:** extract a `quality-run` command that invokes the existing bootstrap,
   selection, gate, review, stamp/merge, and telemetry scripts in this order.
   It writes phase transitions to the existing invocation manifest.
2. **Complete:** make the quality skill a short handoff: create/resume the manifest, invoke
   the runner, and present the judge/remediation request only when the runner
   explicitly pauses at that phase.
3. Add end-to-end fixtures for success, invalid governor state, stale review,
   blocking findings, CI failure, and post-merge cleanup. The old prose path
   remains available only until those fixtures prove behavioral equivalence.
4. Remove duplicate shell-resolution blocks and retire phase-by-phase model
   instructions once the runner is the only executor.

The runner should execute in a fresh, narrowly scoped process or agent. It
must not inherit a long-lived parent conversation merely to obtain a target
directory and manifest path.
