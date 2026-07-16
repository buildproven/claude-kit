# Quality Reference — Flags, Scopes, Levels, and Modes

## Target Resolution (Step -1)

**Bug fixed 2026-05-11**: when invoked as `/bs:quality --merge` with PR
context in the natural-language args (e.g. `#410`, `codex/foo`, or a
worktree path), prior versions ignored those references and audited
whatever happened to be in the operator's cwd — producing irrelevant
reports about uncommitted changes in the primary checkout. Target
resolution (in `scripts/quality-bootstrap.sh`, calling
`scripts/quality-target-resolver.js`) honors, in priority order:

1. **Explicit PR number** in args (`#NNN`, `PR NNN`, `pr#NNN`, `pull/NNN`, or
   `--pr NNN`) — `gh pr view <N> --json headRefName` resolves the head
   branch, then we look up the local worktree.
2. **Branch name** in args (e.g. `codex/foo`, `feat/bar`) or via `--branch`
   — find the local worktree for that branch.
3. **Worktree path** via `--target-dir <path>` / `--target <path>` /
   `--worktree <path>` or any bare absolute-path arg that exists.
4. **cwd is a non-primary worktree** — audit cwd's diff vs base ("I'm
   working in my feature branch worktree" case).
5. **Fallback: primary checkout** — only with a LOUD warning. **Forbidden
   under `--merge`** — `--merge` hard-refuses to fall through to (5).

The parsing + resolution logic is pure and unit-tested at
`scripts/__tests__/quality-target-resolution.test.js`; the bootstrap script
calls it as a subprocess and acts on the JSON result. If no local worktree
exists for a resolved PR/branch, one is materialized in a sibling directory
(`git worktree add`), so repeat invocations reuse it deterministically.

## Reviewer Provider Policy

Claude Code and Codex read the shared workflow policy at
`${XDG_CONFIG_HOME:-~/.config}/buildproven/agent-providers.json`. Configure it
with `scripts/provider-config.sh --primary codex --fallback claude`
(or reverse the providers). `BS_QUALITY_PRIMARY`, `BS_QUALITY_FALLBACK`, and
`BS_QUALITY_PROVIDER_CONFIG` are per-run overrides. The fallback runs only for
typed account exhaustion (HTTP 429, weekly/rate/usage limit, exhausted quota)
or an unavailable CLI—not when the primary reports code findings.

Claude panels share a cancellation sentinel: the first exhausted reviewer
causes sibling process groups to terminate. A successful review records HEAD;
later fix rounds use that SHA as their diff base so unchanged commits are not
reviewed again. Bootstrap clears this state for every new invocation.

## Regression History

- **2026-05-11**: target resolution ignored PR/branch args in favor of
  operator cwd (see above) — fixed by the resolver + priority order.
- **2026-05-12**: `Skill(args=...)` did not propagate into a forked skill's
  `$@` — fixed by the `--args-file` bridge in `quality-bootstrap.sh`.
- **2026-05-13**: cwd and shell vars set in one fenced bash block do not
  survive into the next — every step must restore `$GIT_ROOT` via the
  sentinel dance in `quality-load-root.sh`, or silently operate on the
  fork's raw harness cwd instead of the resolved target.
- **2026-05-21**: the skill bailed to "investigation mode" after a
  successful Step -1 resolution because the worktree had uncommitted
  artifacts from a parallel session — fixed by the explicit "never divert"
  guard at the top of SKILL.md.
- **2026-06-04**: a review child could re-enter `/bs:quality` via a hook,
  agent, or stray `/goal`, causing fork → review child → fork recursion —
  fixed by the `BS_QUALITY_HEADLESS=1` guard in `quality-bootstrap.sh`.
- **2026-07-01**: review agents were spawned via the Task tool. Task-tool
  agents are fire-and-forget — results arrive asynchronously as
  notifications to the PARENT session, never inside the fork's turn — so the
  merge gate downstream of review never ran. This was the #1 way `--merge`
  silently failed to complete; confirmed structural (nested Task agents are
  async too — also breaks inside Task-agent callers).
  Fixed by running review as a blocking subprocess
  (`scripts/claude-review-companion.sh`, invoked from
  `scripts/quality-run-review.sh`).
- **2026-07-01**: `test-generator` was removed from the agent panel — it had
  no agent `.md` file anywhere, and an unresolvable agent is marked
  INCONCLUSIVE by the review runner, which permanently blocks high/critical
  merges. `pr-test-analyzer` covers test quality instead.
- **2026-07-03**: two PRs in one night ran 128min/6 commits and 167min/13
  commits with no circuit breaker on the outer fix→re-review cycle — see
  "Run Governor — Incident History" below for the full writeup and the
  mid-poll wall-clock recheck this produced.
- **2026-07-10**: the review runner (`claude-review-companion.sh`) and the
  governor script were each resolved by checking exactly two hardcoded
  paths. On the primary install (`~/.claude/scripts` → an overlay repo that
  never carried either script) both missed, `bash <missing>` returned 127,
  and the skill printed "MERGE BLOCKED (rc=127)" after doing all the other
  work — the "runs everything, then never merges" stall. Fixed by
  `bs_quality_find_script()` (in `quality-load-root.sh`), which checks every
  known install layout and fails loud if none match.
- **2026-07-10**: `TIER`, `AGENT_COUNT`, and `QUALITY_PIPELINE_RAN` were bash
  variables set in one fenced block (Step 1.8 / Step 2.5) and read in a
  later block (Step 4) — which always saw the `:-false`/empty default
  because bash vars don't cross fenced blocks. Consequences: the auto-stamp
  trailer branch could never fire, and the high/critical Codex XOR gate
  compared `TIER` against `""` and silently failed OPEN. Fixed by the
  `BS_QUALITY_RUNSTATE_FILE` sentinel (same pattern as the git-root and
  governor sentinels) written at the end of Step 2.5's Review Stamp and
  loaded at the top of Step 4.
- **2026-07-11 (#70)**: SKILL.md itself was ~17,300 tokens — the auto-
  compaction re-attach budget is the first 5,000 tokens of each skill (see
  https://code.claude.com/docs/en/skills#skill-content-lifecycle), so
  everything from original Step 1 onward (including the round-cap gate,
  judge synthesis, and all of Step 4's merge gates) was silently dropped
  after any mid-run compaction — exactly the failure mode most likely in the
  long sessions `--merge` runs produce. Fixed by this progressive-disclosure
  split: SKILL.md keeps only the execution flow, the three must-survive
  gates (round cap, companion/model resolution, Step 4 merge gates), and
  navigation pointers; everything else moved to `reference.md`,
  `checklist.md`, or `scripts/`. A CI check (`scripts/check-skill-size.sh`,
  wired as a hard gate in `.github/workflows/quality.yml`) now fails the
  build if any `SKILL.md` in the repo exceeds the budget again.

## Step 1.3: Hard Test Gate — Implementation

Behavioral test evidence must be reviewed and the suite must pass. This is a
hard blocker, not advisory (skip with `--skip-tests` for config-only repos).
SKILL.md Step 1.3 states the rule; the mechanics are here.

**1.3a — Behavioral test evidence signal.** A source-file-to-test-file mapping
is not a valid quality target: behavior often crosses several files and should
be tested once at a stable public seam. Mechanically detect only the strongest
gap signal—production behavior changed but no test changed—then hand it to the
test reviewer to inspect existing coverage.

```bash
source scripts/quality-load-root.sh

CHANGED_SRC=$(git diff --name-only main...HEAD | grep -E '\.(ts|tsx|js|jsx|py|rb|go)$' | grep -v -E '\.(test|spec)\.' || true)
CHANGED_TESTS=$(git diff --name-only main...HEAD | grep -E '(^|/)(test|tests|spec|__tests__)/|\.(test|spec)\.' || true)

if [ -n "$CHANGED_SRC" ] && [ -z "$CHANGED_TESTS" ]; then
  echo "⚠️ Production behavior changed with no test delta."
  echo "   This is a review signal, not proof of missing coverage: inspect existing"
  echo "   tests at the public seam before requesting a new test."
  TEST_GAPS="Production behavior changed with no test delta; verify existing behavioral coverage."
fi
```

**1.3b — Run tests (hard gate).**

```bash
source scripts/quality-load-root.sh
BOUNDED="$(bs_quality_find_script quality-run-bounded.sh)" || exit 1

bash "$BOUNDED" --governor "$BS_QUALITY_GOVERNOR_FILE" \
  --cap 300 --reserve 300 -- npm test 2>&1
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ Tests failed — diagnose and batch-fix the root cause once"
  # Do not rerun an unchanged deterministic failure. Apply the fix, then:
  bash "$BOUNDED" --governor "$BS_QUALITY_GOVERNOR_FILE" \
    --cap 300 --reserve 120 -- npm test 2>&1
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then
    echo "❌ HARD FAIL: Tests still failing after the verified fix attempt"
    echo "Cannot proceed to review agents with broken tests."
    exit 1
  fi
fi
echo "✅ All tests passing"
```

**1.3c — Test-gap reporting.** There is no `test-generator` review agent (it
had no agent definition and was removed from the panel on 2026-07-01;
`pr-test-analyzer` covers test quality). `$TEST_GAPS` is surfaced in the
review context and the summary as a coverage signal for the human, not
handed to an auto-generator. If tests are generated or edited as part of the
auto-fix loop, re-run `npm test` to verify they pass before continuing.

## Flags

| Flag                  | Default | Description                                                                                 |
| --------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `--level N`           | auto    | Quality level: `auto` (read tier from harness-config.json), `95`, or `98`                   |
| `--scope S`           | branch  | Scope: changed, branch, all                                                                 |
| `--merge`             | false   | Auto-merge PR after quality                                                                 |
| `--skip-ci`           | false   | Bypass CI checks                                                                            |
| `--skip-rebase`       | false   | Skip auto-rebase                                                                            |
| `--status`            | false   | Show quality history and exit                                                               |
| `--verbose`           | false   | Show trends with `--status`                                                                 |
| `--audit`             | false   | Read-only assessment                                                                        |
| `--deep`              | false   | 6-agent deep review (with `--audit`)                                                        |
| `--dry-run`           | false   | Preview without modifying                                                                   |
| `--fix`               | false   | Auto-fix common issues (with `--audit`)                                                     |
| `--json`              | false   | Machine-readable output                                                                     |
| `--coverage-diff`     | false   | Show per-file coverage changes                                                              |
| `--skip-docs`         | false   | Skip doc sync check                                                                         |
| `--teams`             | false   | Use agent teams (tmux visibility)                                                           |
| `--no-teams`          | -       | Force Task subagents (default)                                                              |
| `--skip-tests`        | false   | Skip hard test gate (config-only repos)                                                     |
| `--preflight`         | false   | Quick readiness check (<10 sec)                                                             |
| `--target-dir <path>` | -       | Run against this repo (use when invoking from a forked/agent context with no inherited cwd) |

### Environment Variables

| Variable                          | Default | Description                                                                                                                                  |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `BS_QUALITY_PRIMARY`              | config  | Per-run primary override: `claude` or `codex`.                                                                                               |
| `BS_QUALITY_FALLBACK`             | config  | Per-run fallback override: `claude`, `codex`, or `none`.                                                                                     |
| `BS_QUALITY_REVIEW_TIMEOUT`       | tier    | Override the mechanically selected provider wall-clock cap.                                                                                  |
| `BS_QUALITY_TARGET_DIR`           | -       | Default target repo path for forked/agent invocations. Precedence: `--target-dir` > env var > cwd.                                           |
| `BS_QUALITY_TRUST_TARGET_SCRIPTS` | false   | Explicit toolkit-development mode: allow the audited checkout's quality scripts to enforce their own review. Never enable for untrusted PRs. |
| `BS_QUALITY_RESET_CAMPAIGN`       | false   | Explicitly discard the same branch's existing deadline/round state. Never set autonomously after findings or timeout.                        |
| `BS_QUALITY_MAX_FIX_COMMITS`      | 4       | Run-governor cap: max fix commits across the whole invocation before autonomous halt (see below).                                            |
| `BS_QUALITY_MAX_WALL_SECONDS`     | 900     | Absolute local wall-clock deadline for the whole invocation, including fallback and synchronous CI.                                          |

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
- **Absolute deadline** (`BS_QUALITY_MAX_WALL_SECONDS`, default 900 = 15 min) —
  persisted as `deadline_epoch`; every blocking subprocess is clamped to the
  remaining time. Fallback and synchronous CI share the same allowance.
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
provider-neutral `Reviewed-By: quality` plus provider-specific trailers via
an empty commit when HEAD is unstamped. The neutral trailer binds the reviewed
HEAD and merge-base SHAs; later commits invalidate it.

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

- Typical local time: 5-15 min; hard default deadline: 15 min
- All files changed in branch vs main
- Full quality agents on changed files
- Creates PR after quality passes

### `--scope all` (Full Project)

- Uses the same 15-minute default deadline; raise it explicitly for repositories
  whose deterministic full-project checks cannot complete inside that bound
- Every file in the project
- Full quality agents on entire codebase
- For major refactors, pre-release audits

## Quality Levels

### Level auto (Default — tier-aware)

When `harness-config.json` exists in the repo root, the skill reads the resolved risk tier and mechanically selects provider-equivalent depth:

| Tier       | Provider-equivalent depth  | Time cap |
| ---------- | -------------------------- | -------- |
| `low`      | focused regression         | ≤2 min   |
| `medium`   | broad correctness/security | ≤5 min   |
| `high`     | deep adversarial           | ≤8 min   |
| `critical` | release-veto discovery     | ≤10 min  |

If no `harness-config.json` is present, `--level auto` falls back to L95.

Manifest risk is semantic, not path-only. The scorer compares parsed
base-versus-HEAD `package.json` values: metadata stays low; development tooling
and engines are medium; runtime dependencies, exports, bins, and workspaces are
high; install lifecycle hooks, overrides/resolutions, non-registry dependency
sources, and unreadable/structural manifest changes are critical.

### Level 95 (Ship-Ready, no tier classification)

- 6 quality agents regardless of changed-file risk
- For repos without harness-config.json, or to override auto when you want full review on a low-tier change
- Codex runs as cross-reviewer (legacy default)

### Level 98 (Comprehensive — Production-Perfect)

- 10 agents (Phase 1: 7, Phase 2: 3)
- Adds: code-simplifier, accessibility-tester, performance-engineer, architect-reviewer
- Requires at least `--scope branch` (not compatible with changed)
- For production launches, customer-facing features

## Provider Invocation

Codex uses `codex exec` directly with a structured output schema and the
scorer-selected `model_reasoning_effort`; this avoids ambient-effort drift.
Critical discovery is one xhigh pass. A second outer round is one high-effort
targeted verification of persisted findings against the fix delta.
`quality-run-bounded.sh` places each command in a process group and clamps it to
both its stage cap and the run's absolute remaining time:

```
codex exec --ephemeral -s read-only \
  -c 'model_reasoning_effort="high"' --output-schema <schema> -
```

The runner normalizes both current root-level Codex structured output and the
legacy `{result: ...}` envelope before parsing findings. It pins the exact
merge-base SHA before starting the first provider so a fetch in another linked
worktree cannot move `origin/main` and inject reverse-diff findings. Later
rounds review from the last successfully reviewed SHA. Claude uses the same tier
timeout around each parallel reviewer and cancels sibling process groups on
account exhaustion.

## Trailer Convention

```
Reviewed-By: quality (tier=high, reviewer=codex, primary=codex, fallback=claude, findings=0, head=<SHA>, base=<SHA>)
Reviewed-By: codex (tier=high, findings=0, head=<SHA>, base=<SHA>)
```

- `Reviewed-By: quality` is the provider-neutral authorization record.
- The provider-specific trailer records which reviewer actually completed; it
  can differ from `primary` when fallback was required.
- `head` must equal HEAD or HEAD~1 (a dedicated stamp commit), and `base` must
  equal the current merge-base. Any later code commit invalidates the stamp.

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
2. Enable required-check-gated auto-merge via `gh pr merge --auto --squash`
3. If auto-merge is unavailable, bounded-watch CI using the same governor;
   return `LOCAL_PASS_CI_PENDING` when the deadline is spent
4. Manually verify the deployed system using your normal deployment tooling

## Next-Step Suggestions (CS-046)

After quality completes:

- `--merge`: "Run `/clear` then `/bs:dev` for next feature"
- Failed: "Run `/debug` to investigate"
- `--audit`: "Run `/bs:quality` to fix issues found"

## Parallel Sub-Review Mode (`--parallel`, acpx)

When invoked with `--parallel`, fire security, coverage, and perf sub-reviews
as concurrent acpx sessions instead of running them sequentially inside the
main loop. Requires acpx >= 0.5.3 (commands are agent-scoped, `acpx claude
…`, in current versions).

1. **Check acpx availability**: `command -v acpx`. If unavailable, fall back
   to sequential (log a warning) — see Fallback below.
2. **Create sessions, then fire prompts concurrently**:

```bash
source scripts/quality-load-root.sh   # GIT_ROOT resolved, cwd restored

TIMESTAMP=$(date +%s)
for kind in security coverage perf; do
  acpx claude sessions new --name "quality-${kind}-${TIMESTAMP}" >/dev/null
done

acpx claude prompt --no-wait -s "quality-security-${TIMESTAMP}" \
  "Security review: examine [diff/files] for OWASP top 10, secrets, injection flaws. Output structured findings."
acpx claude prompt --no-wait -s "quality-coverage-${TIMESTAMP}" \
  "Coverage review: examine [diff/files] for missing tests, uncovered branches, weak assertions. Output structured findings."
acpx claude prompt --no-wait -s "quality-perf-${TIMESTAMP}" \
  "Performance review: examine [diff/files] for N+1 queries, unguarded loops, missing memoization. Output structured findings."
```

3. **Poll until all sessions complete** (status can stay "running"
   post-completion, so detect an assistant entry after the latest user entry
   via history):

```bash
session_done() {
  local session="$1"
  acpx claude sessions read "$session" --tail 4 2>/dev/null \
    | awk '/^user/{u=NR} /^assistant/{a=NR} END{exit !(a>u)}'
}

for session in quality-security-${TIMESTAMP} quality-coverage-${TIMESTAMP} quality-perf-${TIMESTAMP}; do
  for _ in $(seq 1 80); do
    session_done "$session" && break
    sleep 3
  done
done
```

4. **Collect outputs** (read session history):

```bash
SECURITY_OUT=$(acpx claude sessions read "quality-security-${TIMESTAMP}" --tail 1)
COVERAGE_OUT=$(acpx claude sessions read "quality-coverage-${TIMESTAMP}" --tail 1)
PERF_OUT=$(acpx claude sessions read "quality-perf-${TIMESTAMP}" --tail 1)

for kind in security coverage perf; do
  acpx claude sessions close "quality-${kind}-${TIMESTAMP}" >/dev/null 2>&1 || true
done
```

5. **Synthesize**: combine all three outputs into the unified quality report
   (same format as sequential mode). Continue to Step 2 (Agent Result
   Validation) as normal.

### Fallback

If `acpx` is not installed or any session fails to launch, log:

```
[quality] acpx unavailable or launch failed — falling back to sequential sub-reviews
```

Then run security → coverage → perf in order using the standard sequential
flow.

## Run Governor — Incident History

Two PRs in one night (#529: 128min/6 commits, #532: 167min/13 commits)
completed with no circuit breaker on 2026-07-03 — `CODEX_ROUNDS` only bounds
the inner Codex adversarial loop, not the outer cycle of BLOCKING-finding ->
auto-fix -> re-review across the whole invocation. This led to
`scripts/quality-run-governor.js`, which tracks a per-invocation JSON
sentinel (alongside the Step -1 git-root sentinel) with a fix-commit cap, a
wall-clock cap, and repeated-finding-shape detection (see the script's own
header comment for the full mechanism).

A follow-up 2026-07-10 finding: the original governor had no _round_
dimension and was never called on the review leg itself — its three call
sites were all downstream of the panel. `bump-round` (called immediately
before every review panel, see SKILL.md Step 2.0) closes that gap: it is the
governor call that actually terminates the outer fix -> re-review loop, by
incrementing `rounds_used` and exiting non-zero at `max_review_rounds`
(default 3). Before that fix, the round cap was a sentence of prose — and
since the MODEL orchestrates this loop, prose is not a cap.

A further 2026-07-15 finding showed a foreground Codex review could outlive the
governor entirely. `quality-run-bounded.sh` now owns the process-group kill and
clamps every stage to the absolute remaining run budget. Timeout does not
trigger fallback; only immediate unavailability or typed account exhaustion
does.

**Never make the governor check silently optional.** Every call site fails
CLOSED when the governor script or its sentinel file is missing or
unreadable — a bare `if [ -f ... ] && [ -f ... ]; then ... fi` with no `else`
was independently flagged by 4 review agents across two rounds as
reintroducing exactly the "circuit breaker quietly stopped breaking" failure
mode this whole feature exists to prevent.
