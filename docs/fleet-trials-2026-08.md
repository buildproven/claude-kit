# Fleet trials — 2026-08-12

The public runtime was invoked by absolute distributable path from three
unrelated real repositories without mutating them. Each selection completed in
0.07 seconds wall time. Plugin packaging was separately checked with
`claude plugin validate .`.

| Class                                   | Representative change                             | Result                   | Reason                                                        |
| --------------------------------------- | ------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `retire-runway` Node/TypeScript product | `src/app.ts`, `tests/app.test.ts`                 | focused `vitest related` | Vitest has a dependency-aware selector                        |
| `buildproven` Python/mixed product      | `scripts/publisher.py`, `tests/test_publisher.py` | unmapped                 | Python source needs a repository-owned test mapping           |
| `starknet` operational/private          | workflow plus shell deploy script                 | unmapped                 | workflow and shell paths need repository-owned contract tests |

The original trial classified the last two rows as complete-suite fallbacks.
BUI-733 corrected that policy: missing impact evidence is now a visible mapping
gap, not permission to spend the fixed cost of every test. A complete run is an
explicit scheduled, release, dependency-graph, or risk-exception audit. This is
not evidence of customer adoption or market demand.

Provider-path evidence from the same program:

- Claude completed the architecture review in two bounded rounds.
- Codex `power` launched Sol/high successfully after profile migration.
- A bounded Claude review of the BuildProven CI trigger returned `NO_FINDINGS`
  without running tests or expanding repository context.

Cleanup evidence: trials wrote only temporary output under `/tmp`; no target
repository was edited by the planner.
