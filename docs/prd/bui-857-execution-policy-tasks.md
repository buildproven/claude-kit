# Execution-policy acceptance tasks

- [x] 1.0 Share native routing advice through the compute governor
  - Phase: implementation
  - Delivers: Deterministic advice preserves coordinator choice, inherited context, capability checks and calibrated route floors.
  - Evidence: compute-governor-native and legacy compute-governor behavioral tests.

- [x] 2.0 Share affected-test selection with task completion
  - Phase: implementation
  - Delivers: Configured affected commands run for staged, unstaged, deleted and untracked changes; failed tests stay failed. Missing implicit test inputs block instead of passing an empty related-test run. Hook, CI and quality producers retain deletions and both rename paths.
  - Evidence: task-completed-check, test-impact, quality-workflow-bootstrap and quality-invocation behavioral regressions.

- [x] 3.0 Align runtime instructions
  - Phase: implementation
  - Delivers: Native advice can fall back to safe local work; quality references no longer prescribe obsolete panels, retries or direct merge paths.
  - Evidence: CSC-1, skill-size checks and quality behavioral regressions.
