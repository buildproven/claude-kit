# BUI-822 tasks

- [x] 1.0 Fund the native Claude Kit test gate
  - Phase: implementation
  - Delivers: A bounded campaign has enough reserved time for the measured test gate, security, mutation, and review.
  - Evidence: Planner regression test and exact-head full-suite result.

- [x] 2.0 Correct quality-control path classification
  - Phase: implementation
  - Delivers: Quality-control configuration can use the contract claim while unknown application configuration remains fail-closed.
  - Evidence: Classifier unit test and quality-run integration test.

- [x] 3.0 Preserve continuity after provider failure
  - Phase: implementation
  - Delivers: A campaign retains signed incomplete review evidence and continues to deterministic merge authorization after the bounded same-range retry.
  - Evidence: Authorization and quality-run orchestration regression tests.
