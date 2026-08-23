# Compute Governor

Compute Governor gives fresh autonomous workers one explicit model, effort,
access profile, runtime cap, prompt hash, and exact Git revision. It does not
change the interactive builder model.

## Phase-v2 workers

Schema v2 covers `scan`, `plan`, `implement`, `verify`, `remediate`, `diagnose`,
and `review`. Create a request:

```json
{
  "schemaVersion": 2,
  "caller": "interactive-ralph",
  "provider": "codex",
  "phase": "implement",
  "evidence": {
    "localized": true,
    "reversible": true,
    "targetedProof": true,
    "ambiguous": false,
    "changedFiles": 1,
    "protectedSurfaces": [],
    "publicContract": false,
    "crossRepository": false,
    "plannedPaths": ["src/feature/"]
  }
}
```

Resolve without launching:

```bash
node ~/.claude/scripts/compute-governor.js resolve-phase-execution \
  phase-request.json prompt.md /path/to/clean/worktree
```

Launch:

```bash
bash ~/.claude/scripts/provider-run.sh \
  --prompt-file prompt.md \
  --phase-request phase-request.json \
  --caller interactive-ralph \
  --provider codex \
  --fallback none \
  --target-dir /path/to/clean/worktree \
  --output-dir /tmp/run-evidence
```

V2 uses the reliable `standard` Codex route for ordinary work and `critical`
for auth, authorization, payments, durable data, migrations, public contracts,
deployment, security, and cross-repository work. Economy execution is disabled
until application telemetry, exact token data, lineage, budgets, and late-defect
adjudication can prove it safe. Repeated-failure escalation is also deferred
until that lineage exists.

Caller policy and phase derive access. `scan`, `plan`, and `review` are
read-only. `implement`, `remediate`, and `diagnose` use workspace-write in a
detached exact-HEAD worktree. `verify` and every Claude v2 request fail closed
before provider launch until their OS sandbox or independent verifier exists.
Supported v2 entrypoints also pass a fixed `--caller` argument. The runner
requires it to match the request or plan before provider launch.

The Codex v2 adapter pins approval, disables ambient MCP/plugins/hooks/search,
passes a minimal environment, and binds the execution-profile digest into the
plan and receipt. This is a target mutation-integrity boundary, not a host
confidentiality boundary.

Before write handoff, the runner freezes and hashes one binary patch. It permits
only regular-file additions and content modifications with a stable file mode
inside planned paths. Protected paths match at any directory depth. Protected,
unknown, malformed, ignored, symlink, gitlink, rename, copy, delete, mode-change,
type-change, unmerged, and out-of-plan workspace-write changes stop as
`replan-required`. Read-only tracked changes also stop; ignored read-only cache
files are discarded with the detached worktree and never enter a handoff. One
repository lease fences destination validation, exact patch application,
digest verification, rollback, and release.

The v2 `run-record.json` persists only the plan, requested/effective identity,
execution-profile digest, timing, typed outcome, and redacted exact token usage
when the provider reports it. Missing usage stays `null`. Prompts, credentials,
raw responses, and arbitrary provider metadata are rejected.

## Frozen schema v1

Existing `--execution-facts` and `--execution-plan` callers keep the frozen v1
policy, resolver, plan, record, and validation behavior. Legacy `test` remains
`test`. Claude cross-review and explicitly selected Claude Ralph/steward workers
stay on v1 until Claude has the required v2 OS sandbox.

Every call to `provider-run.sh` must choose one mode: `--phase-request`,
`--execution-facts`, `--execution-plan`, or a policy-known specialized exemption
for the quality or strategy panel. Raw unclassified provider launches fail.

See [ADR-phase-adaptive-worker-routing.md](decisions/ADR-phase-adaptive-worker-routing.md)
for the reviewed decision and deferred automatic-economy control plane.
