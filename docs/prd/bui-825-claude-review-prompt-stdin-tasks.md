# BUI-825 tasks

- [x] 1.0 Reproduce the host argument-list failure
  - Phase: diagnosis
  - Delivers: Exact stderr and a red stdin transport regression.
  - Evidence: PR 458 review attempts 2 and 3, rc 126.

- [x] 2.0 Stream the exact prompt to Claude
  - Phase: implementation
  - Delivers: The existing bounded Claude process reads the prompt from stdin.
  - Evidence: Companion behavioral tests and live PR 458 fallback.
