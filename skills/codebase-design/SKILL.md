---
name: codebase-design
description: Design and refactor deep modules with small interfaces, clean seams, high caller leverage, and tests through public behavior. Use for architecture, refactoring, interface design, testability problems, pass-through abstractions, or scattered change.
---

# Codebase Design

Design modules that hide meaningful complexity behind a small, stable
interface. This vocabulary and discipline are adapted from Matt Pocock's
MIT-licensed `codebase-design` skill; see `NOTICE`.

## Vocabulary

- **Module** — an interface plus its implementation, at any scale.
- **Interface** — everything callers must know: operations, invariants, error
  modes, ordering, configuration, and performance expectations.
- **Seam** — where behavior can vary without editing the caller.
- **Adapter** — a concrete implementation that occupies a seam.
- **Depth** — useful behavior delivered per unit of interface callers learn.
- **Leverage** — capability reused by many callers through one interface.
- **Locality** — changes, knowledge, bugs, and verification concentrated in
  one place.

## Design tests

### Deletion test

Imagine deleting the module:

- If complexity disappears, it may be a pass-through.
- If the complexity spreads back across callers, the module is earning its
  place.

### Interface test

Callers and tests should use the same supported seam. If tests must reach
through the interface into internals, either the test is coupled to
implementation or the module is shaped incorrectly.

### Variation test

One adapter is often a hypothetical abstraction. Introduce a seam when
behavior actually varies, external effects need isolation, or the interface
meaningfully concentrates complexity.

## Deepening workflow

1. Identify repeated knowledge or coordination spread across callers.
2. Name the behavior callers actually need, not the internal steps.
3. Design the smallest interface that provides that behavior.
4. Move policy, validation, sequencing, and failure handling behind it.
5. Test through the public interface.
6. Delete superseded helpers and pass-through layers.

Prefer accepting dependencies over constructing them invisibly, returning
results over mutating distant state, and explicit failure modes over silent
fallbacks.

## Architecture escalation gate

Draft at the normal runtime profile. Before implementation, create a short Architecture Decision Record when the change affects auth/payments, durable data/migration, public APIs/events, distributed consistency, cross-repository dependencies, or another expensive-to-reverse boundary. Record the decision, alternatives, invariants, rollback, and verification; review only that record in Opus/high (Claude Code) or with `codex --profile power exec --ephemeral -s read-only -c 'model_reasoning_effort="high"' review --base <base>`. The Codex `power` profile must pin a current high-end model. Ordinary refactors do not escalate merely because they are large.

## Review questions

- Can the interface expose fewer concepts?
- Does each parameter represent caller intent rather than implementation detail?
- Is the abstraction hiding complexity or merely renaming it?
- Would a future change be fixed once here or repeated across callers?
- Can the behavior be verified without knowing the implementation?
