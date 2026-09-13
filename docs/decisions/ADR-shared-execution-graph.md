# Shared execution graph and verification ownership

Status: accepted for implementation after bounded independent Sol/high review
on 2026-09-09 (session 01a083e3-1e7b-7c80-88d8-7dfb4a59f7c7).
The first broad review timed out; the scoped ADR review returned no blocking
design defects. This is design evidence, not implementation or merge approval.

## Root cause

The existing quality graph is revision-bound, but surrounding hooks, native
delegation and outer loops carry separate policy and evidence. Product admission
is also required before its supporting service is operational. This creates
repeated work, unclear completion states and blocked delivery.

## Decision

Extend existing kit interfaces, not a second scheduler. Ship portable behavior in
kit; setup pins the reviewed kit and owns private provider/capacity preferences.
Keep ordinary Codex/Claude sessions as entrypoints. Never overwrite the selected
interactive coordinator model or require a new launcher.

Delivery is a dependency graph:

1. Capability preflight (read-only, before expensive gates).
2. Requirements and risk; conditional architecture review.
3. Implementation with bounded repair and affected-test feedback.
4. Existing quality deterministic gates and independent review.
5. Exact-head engineering readiness and required CI.
6. Protected product admission, when required by the declared claim.
7. Existing authorized exact-head merge and cleanup.

Engineering readiness, admission and merge are separate states. No readiness
receipt grants merge authority or sets Linear Done. Existing default merge
semantics remain unchanged. A review-ready target is explicit and durable, and
must retain outstanding admission requirements. Resuming retains identity and
budgets. A changed head invalidates readiness. Provider failure is not success.

Reuse BUI-836 / PR477's protected producer and admission contract; do not create
a second signing implementation. Before touching overlapping files, reconcile
the upstream candidate. Missing keys or unmerged infrastructure are explicit
external blocks. No credentials are provisioned or production workflows activated
without operator approval. Independent work can continue before that boundary.

## Interfaces and invariants

- Extend compute-governor with a versioned native advisory decision interface.
  It must distinguish tools/local work from delegation and configured/requested/
  observed models. Existing v1/v2 launch and isolation contracts stay unchanged.
  Native guidance does not claim enforcement that the client cannot provide.
- Use approved concrete model mappings behind semantic task roles. Capability
  availability and explicit user overrides are inputs. Unknown availability must
  not silently cause a model launch. Economy stays candidate-only until BUI-793's
  evidence conditions are met. A shadow recommendation launches no model.
- Native adapters preserve parent selection, permissions and required context.
  Full-history forks inherit; bounded/fresh forks may use supported overrides.
  No API-backed paid fallback. No global quota guarantee for unmanaged windows.
- Reuse test-impact for task-completion checks. Include staged, unstaged and
  untracked changes with NUL-safe paths. Unmapped code is a visible mapping error.
  Repository package-manager behavior remains authoritative. Do not inject
  runner-specific pass-with-no-tests flags into arbitrary test scripts.
- Local verification reuse must bind source, dependencies, command, policy and
  environment; do not reuse working-tree proof as exact-head release proof.
  Start with shared selection if a safe shared cache cannot be proved.
- Align required quality instructions with runtime behavior. Remove obsolete
  alternative execution loops, panels and merge commands, not safeguards.
- Use existing telemetry/usage parsing and loop state for lineage and bounded
  recovery. Preserve missing usage as null. Keep fixture, canary and real-task
  populations separate. No optimal-model or efficiency claim without measurement.

## Alternatives

- New external graph framework: rejected; adds another state owner and launcher.
- Remove admission checks: rejected; silently weakens accepted merge authority.
- Roll every client onto cheaper models: rejected; changes user intent and lacks
  acceptance evidence. Start with observable policy and bounded native canaries.
- Keep all checks everywhere: rejected; test selection knowledge remains split.

## Delivery slices

1. Canonical policy and hook test-selection integration with behavioral tests;
   short, consistent quality instructions.
2. Native decision/explain interface, capability validation and client guidance;
   install tests preserving existing settings and unsupported-client reporting.
3. Readiness/admission integration coordinated with PR477; durable loop handoff,
   exact identity, bounded resume and non-success blocked states.
4. Private setup pin and preferences, canary verification in ordinary sessions,
   whole-task measurement and conservative rollout. No bulk product-repo edits.

Each slice has its own branch/PR when concerns separate. Followups remain in
Linear, not a new repository backlog. This ADR is the design source of truth.

## Verification and rollback

Test public CLI/hook interfaces: same task yields same decision; local tools
need no model; missing/unsupported capability does not launch; explicit model
choice survives; sensitive changes preserve review floors; changed source
invalidates reuse; unmapped/untracked code cannot pass silently; failed tests
remain failures; resume does not reset budgets; readiness cannot authorize merge;
stale or foreign evidence is rejected; required CI stays mandatory.

Use focused tests first and full audit for selector-policy changes. Independent
review, security and exact-head quality still gate delivery. Inspect release and
deployment triggers before merge. Installation follows tested upstream delivery,
never direct edits to installed symlinks or the dirty core checkout.

Rollback reverts each owned change and restores the prior tested setup pin.
Keep old campaign readers compatible; fail visibly on unsupported new state.
No automatic migration that erases evidence or resets exhausted budgets.
