# Quality Reference — Flags, Scopes, Levels, and Modes

## Flags

| Flag                      | Default | Description                                                                                              |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `--level N`               | auto    | Quality level: `auto` (read tier from harness-config.json), `95`, or `98`                                |
| `--scope S`               | branch  | Scope: changed, branch, all                                                                              |
| `--merge`                 | false   | Auto-merge PR after quality                                                                              |
| `--skip-ci`               | false   | Bypass CI checks                                                                                         |
| `--skip-rebase`           | false   | Skip auto-rebase                                                                                         |
| `--status`                | false   | Show quality history and exit                                                                            |
| `--verbose`               | false   | Show trends with `--status`                                                                              |
| `--audit`                 | false   | Read-only assessment                                                                                     |
| `--deep`                  | false   | 6-agent deep review (with `--audit`)                                                                     |
| `--dry-run`               | false   | Preview without modifying                                                                                |
| `--fix`                   | false   | Auto-fix common issues (with `--audit`)                                                                  |
| `--json`                  | false   | Machine-readable output                                                                                  |
| `--coverage-diff`         | false   | Show per-file coverage changes                                                                           |
| `--skip-docs`             | false   | Skip doc sync check                                                                                      |
| `--teams`                 | false   | Use agent teams (tmux visibility)                                                                        |
| `--no-teams`              | -       | Force Task subagents (default)                                                                           |
| `--no-codex`              | false   | Skip Codex cross-review entirely                                                                         |
| `--codex-effort E`        | high    | Codex reasoning effort: `medium`, `high`, or `xhigh`                                                     |
| `--codex-skip "<reason>"` | -       | Skip Codex on this run with a non-empty reason (logged + Quality-Skip trailer required at high/critical) |
| `--skip-tests`            | false   | Skip hard test gate (config-only repos)                                                                  |
| `--preflight`             | false   | Quick readiness check (<10 sec)                                                                          |
| `--target-dir <path>`     | -       | Run against this repo (use when invoking from a forked/agent context with no inherited cwd)              |

### Environment Variables

| Variable                      | Default | Description                                                                                        |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `CODEX_TIMEOUT`               | 120     | Seconds to wait for Codex cross-review (0=skip)                                                    |
| `BS_QUALITY_TARGET_DIR`       | -       | Default target repo path for forked/agent invocations. Precedence: `--target-dir` > env var > cwd. |
| `BS_QUALITY_MAX_FIX_COMMITS`  | 4       | Run-governor cap: max fix commits across the whole invocation before autonomous halt (see below).  |
| `BS_QUALITY_MAX_WALL_SECONDS` | 1800    | Run-governor cap: max wall-clock seconds across the whole invocation before autonomous halt.       |

### Run Governor (runaway-loop guardrails)

Two PRs run in one night (#529: 128min/6 commits, #532: 167min/13 commits)
completed with no circuit breaker — `CODEX_ROUNDS` only bounds the inner Codex
adversarial loop, not the outer cycle of BLOCKING-finding → auto-fix →
re-review across the whole invocation. `scripts/quality-run-governor.js`
tracks a per-invocation sentinel (`$TMPDIR/bs-quality-gitroot-*-governor.json`,
alongside the Step -1 git-root sentinel) with:

- **Fix-commit cap** (`BS_QUALITY_MAX_FIX_COMMITS`, default 4) — commits made
  since the run started, checked before every fix attempt and every Codex
  re-verification round.
- **Wall-clock cap** (`BS_QUALITY_MAX_WALL_SECONDS`, default 1800 = 30 min) —
  elapsed time since the run started, checked at the same points.
- **Repeated-pattern detection** — findings are recorded round-over-round;
  if a round's findings mostly repeat a shape seen in an earlier round (e.g.
  the same on-disk-vs-loaded-job gap at 4 different call sites), the skill is
  told to batch-fix every matching call site in one commit instead of
  spending a separate round per occurrence.
- **Live status** — every round prints `[quality] elapsed Xm/Ym, fix-commits
N/M` so the operator can see the loop's position in real time, not just in
  the final summary.

**On a tripped cap**, the skill hard-stops autonomous continuation — no
further rounds, no `--merge` — and hands back a plain-text summary of what
was tried, why it didn't converge, and the exact re-invocation command to
raise the cap (e.g. `BS_QUALITY_MAX_FIX_COMMITS=8 /bs:quality --merge`). The
skill never raises its own cap; that is an explicit operator decision.

**`BS_QUALITY_TARGET_DIR` usage**: when a spawning harness (e.g. a Task agent
running in an isolated worktree) exports this env var, every forked
`/bs:quality` invocation in that scope auto-targets the right repo without
needing `--target-dir` on each call. Prevents the "forked skill silently
scanned the agent's cwd" failure mode.

### Auto-stamped review trailer

When `--merge` is used and the quality pipeline ran in the same invocation
(Step 1.8 completed), the merge gate (Step 4) auto-stamps a
`Reviewed-By: claude-quality` trailer via an empty commit if no existing
commit on the branch carries one. This makes the gate consistent regardless
of whether the fix commits happened to include the trailer.

If the pipeline did NOT run in this invocation (e.g. operator passed
`--merge` alone with no prior quality work), the gate hard-blocks instead
of auto-stamping — auto-stamping then would be forging review evidence.

## Scope Options

### `--scope changed` (Quick)

- Time: 2-5 min
- Checks uncommitted changes only
- Runs lint, type-check, tests on changed files
- Skips quality agents — automated checks sufficient
- Auto-commits with smart message

### `--scope branch` (Default)

- Time: 30-60 min
- All files changed in branch vs main
- Full quality agents on changed files
- Creates PR after quality passes

### `--scope all` (Full Project)

- Time: 45-90 min
- Every file in the project
- Full quality agents on entire codebase
- For major refactors, pre-release audits

## Quality Levels

### Level auto (Default — tier-aware)

When `harness-config.json` exists in the repo root, the skill reads the resolved risk tier from `scripts/risk-policy-gate.js` and routes agents + Codex per tier:

| Tier       | Claude agents                                 | Codex role          | Time cap |
| ---------- | --------------------------------------------- | ------------------- | -------- |
| `low`      | 2 (code-reviewer + silent-failure-hunter)     | skip                | ≤2 min   |
| `medium`   | 4 (+ type-design-analyzer + security-auditor) | judge findings      | ≤8 min   |
| `high`     | 6 (full L95)                                  | judge + adversarial | ≤25 min  |
| `critical` | 6 + existing `break-glass-approval` check     | judge + adversarial | ≤25 min  |

If no `harness-config.json` is present, `--level auto` falls back to L95.

### Level 95 (Ship-Ready, no tier classification)

- 6 quality agents regardless of changed-file risk
- For repos without harness-config.json, or to override auto when you want full review on a low-tier change
- Codex runs as cross-reviewer (legacy default)

### Level 98 (Comprehensive — Production-Perfect)

- 10 agents (Phase 1: 7, Phase 2: 3)
- Adds: code-simplifier, accessibility-tester, performance-engineer, architect-reviewer
- Requires at least `--scope branch` (not compatible with changed)
- For production launches, customer-facing features

## Codex Invocation

The canonical CLI is the codex-companion plugin (NOT `codex:rescue` — rescue is for hand-offs, review must be bounded):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" \
  adversarial-review --wait --base <resolved-base> --scope branch [focus text]
```

Flags:

- `--codex-effort high` (default) | `medium` | `xhigh`
- `--no-codex` — skip entirely
- `--codex-skip "<reason>"` — skip on this run only; non-empty reason required; at `high`/`critical` writes a `Quality-Skip` trailer with full HEAD + base SHAs (verified at merge time)

Wait/background:

- `medium` tier (judge): `--wait` (foreground)
- `high` / `critical` tier (judge + adversarial): `--background` then poll via companion `status` / `result`

The `--base` arg uses the resolved base from `risk-policy-gate.js` (origin/main → origin/master → main → master), NOT hardcoded `main`.

## Trailer Convention

```
Reviewed-By: claude-quality (tier=high, agents=6, findings=0)
Reviewed-By: codex (tier=high, mode=judge+adversarial, status=pass, findings=0)
```

- `Reviewed-By: claude-quality` is always written (preserves CI grep in `harness-gate.yml`)
- `Reviewed-By: codex` is added only when Codex actually ran (medium+ tiers, not skipped)
- `Quality-Skip: codex-judge (reason="..."; head=<SHA>; base=<SHA>)` — required at `high`/`critical` when `--codex-skip` is used. Trailer SHAs are verified against current HEAD + merge-base before merge — stale trailers cannot authorize a new merge.
- `.claude/quality-skip-log.json` is **telemetry only** — never authoritative for whether a skip was authorized.

## Deep Review Mode (`--audit --deep`)

Spawns 6 agents in parallel:

| Agent                 | Focus                           | Return Format       |
| --------------------- | ------------------------------- | ------------------- |
| code-reviewer         | Bugs, logic errors, code smells | JSON findings array |
| silent-failure-hunter | Empty catches, swallowed errors | JSON findings array |
| type-design-analyzer  | Any abuse, weak generics        | JSON findings array |
| security-auditor      | OWASP top 10, secrets           | JSON findings array |
| performance-engineer  | N+1, memory leaks               | JSON findings array |
| architect-reviewer    | Tech debt, patterns             | JSON findings array |

After completion:

1. Display agent summary table
2. If `--dry-run=false`: create Linear issues for findings via mcp**linear**create_issue
3. If `--dry-run=true`: preview without modifying

## Teams Mode (`--teams`)

Uses agent teams instead of Task subagents. Provides:

- tmux split-pane visibility
- Cross-reviewer communication
- Coordinated retry on failures

Best for `--level 98` or `--scope all` (10+ min runs). Task subagents are faster for quick runs.

## Merge Flow (`--merge`)

1. Push branch, create PR
2. Wait for CI (unless `--skip-ci`)
3. Auto-merge via `gh pr merge --squash`
4. Manually verify the deployed system using your normal deployment tooling

## Next-Step Suggestions (CS-046)

After quality completes:

- `--merge`: "Run `/clear` then `/bs:dev` for next feature"
- Failed: "Run `/debug` to investigate"
- `--audit`: "Run `/bs:quality` to fix issues found"
