# Quality assurance contract v1

The public contract is the small interchange surface for any Claude Code or
Codex builder. Internal leases, retries, and provider lifecycle state remain
private runtime details.

Validate an envelope:

```bash
node scripts/quality-assurance-contract.js assurance-envelope.json
```

The schema at
`scripts/schemas/quality-assurance-envelope.schema.json` binds requirements,
repository/base/head/candidate identity, risk, deterministic gates, advisory
review evidence, terminal result, and an optional merge receipt. Existing v1
fields are stable; additive data requires a new schema version when it changes
consumer interpretation.

Terminal results have deliberately narrow meanings:

- `passed`: deterministic evidence is complete for the exact candidate.
- `blocked`: a deterministic gate, authorization, freshness, or policy check
  failed.
- `incomplete`: required evidence is unavailable or malformed; it is never a
  clean result.

Use `scripts/test-impact.js <changed-files...>` for the conservative inner-loop
plan. JS/TS uses Vitest's dependency-aware related selector, changed Python
tests can run directly, documentation-only changes need no behavioral tests,
and Python source, configuration, styles, workflows, shell, dependencies, or an
unknown change set select the complete suite. The final exact candidate still
requires one complete suite unless repository policy explicitly proves an
equivalent gate.

Use `scripts/quality-ci-evidence.js` to ingest one trusted GitHub Actions check.
It reuses a cached result only for the identical repository, workflow, check,
base SHA, candidate SHA/kind, GitHub Actions source, URL, and successful
conclusion. Any identity change fetches again or fails closed.
