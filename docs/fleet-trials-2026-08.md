# Fleet trials — 2026-08-12

The public runtime was invoked by absolute distributable path from three
unrelated real repositories without mutating them. Each selection completed in
0.07 seconds wall time. Plugin packaging was separately checked with
`claude plugin validate .`.

| Class                                   | Representative change                             | Result                   | Reason                                                          |
| --------------------------------------- | ------------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `retire-runway` Node/TypeScript product | `src/app.ts`, `tests/app.test.ts`                 | focused `vitest related` | Vitest has a dependency-aware selector                          |
| `buildproven` Python/mixed product      | `scripts/publisher.py`, `tests/test_publisher.py` | complete suite           | changed Python source has no proven cross-file dependency graph |
| `starknet` operational/private          | workflow plus shell deploy script                 | complete suite           | control-plane and shell changes are graph escape hatches        |

This is the intended safety/efficiency boundary: focus only where the test tool
can prove related coverage; otherwise pay for one complete exact-candidate run.
It is not evidence of customer adoption or market demand.

Provider-path evidence from the same program:

- Claude completed the architecture review in two bounded rounds.
- Codex `power` launched Sol/high successfully after profile migration.
- A bounded Claude review of the BuildProven CI trigger returned `NO_FINDINGS`
  without running tests or expanding repository context.

Cleanup evidence: trials wrote only temporary output under `/tmp`; no target
repository was edited by the planner.
