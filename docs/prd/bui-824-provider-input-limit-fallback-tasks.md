# BUI-824 tasks

- [x] 1.0 Classify deterministic primary input-limit failures
  - Phase: implementation
  - Delivers: The runtime records a typed input-limit result with bounded size metadata.
  - Evidence: Provider-error classifier tests.

- [x] 2.0 Route the exact envelope to the configured fallback
  - Phase: implementation
  - Delivers: The fallback runs once without truncating the diff or retrying an impossible primary input.
  - Evidence: Provider runtime and merge-policy tests.

- [x] 3.0 Preserve pending CI when review-check publication is unavailable
  - Phase: implementation
  - Delivers: Merge waits for exact-head CI and signs local review evidence only after CI is green.
  - Evidence: Merge-gate regression and the live PR 460 failure reproduction.
