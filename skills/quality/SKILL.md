---
name: quality
description: Autonomous quality loop with configurable thoroughness (95% or 98%). Runs lint, tests, build, security scans, and specialized quality agents. Auto-fixes issues and creates PRs.
context: fork
# Runs unattended (forked, no user in the loop). AskUserQuestion here would
# block forever with nobody to answer it — remove the tool, don't just ask it
# nicely not to. https://code.claude.com/docs/en/skills
disallowed-tools: AskUserQuestion
---

> **FORKED SKILL INVOCATION — EXECUTE STEP -1 IMMEDIATELY.** This skill was
> already invoked by `/bs:quality`; args arrive via the `--args-file` channel
> (Step -1), not necessarily as a fresh user message. If the visible context
> has no new user prompt, treat that as expected fork startup and run Step -1
> now — do not wait or report "no user task."

# Quality Skill — Autonomous Quality Loop

Makes your project ship-ready in one autonomous command. **This is
AUTONOMOUS — do NOT stop and ask the user between loops.**

> **NEVER divert to "investigate uncommitted state" mode.** Once Step -1
> resolves a target, execute the pipeline end to end. Uncommitted files in
> the resolved worktree are EXPECTED (they're the changes being audited).
> Forbidden after a successful Step -1: reporting "no PR/branch," listing
> uncommitted files and asking what to do, bailing on "ambiguous" state, or
> refusing `--merge` after a non-`primary-fallback` resolution. See
> `reference.md` "Regression History" for the incidents these guards exist
> to prevent. Only stop early for: hard-failing tests/lint/build that can't
> auto-fix, a high/critical finding needing human input, or failing required
> CI on the target PR.

## Execution Flow

### Step -1: Resolve Audit Target + Init Governor

Target resolution (PR number, branch name, `--target-dir`, or cwd-worktree,
in that priority order — full detail in `reference.md` "Target Resolution")
and run-governor init both live in `scripts/quality-bootstrap.sh`. Run it
first, in every invocation:

```bash
BOOTSTRAP=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-bootstrap.sh" \
  "${CLAUDE_KIT_ROOT:-}/scripts/quality-bootstrap.sh" \
  "$HOME/.claude/scripts/quality-bootstrap.sh" \
  "./scripts/quality-bootstrap.sh"; do
  [ -n "$candidate" ] && [ -f "$candidate" ] && { BOOTSTRAP="$candidate"; break; }
done
[ -n "$BOOTSTRAP" ] || { echo "❌ quality-bootstrap.sh not found on any candidate path" >&2; exit 1; }
bash "$BOOTSTRAP" "$@"
```

This prints `BS_QUALITY_ROOT_FILE=`, `BS_QUALITY_GOVERNOR_FILE=`, and
`GIT_ROOT=` — the pipeline's persistent state, since each Bash tool call is a
fresh shell and none of these survive as plain variables. A non-zero exit
means target resolution failed (no target, ambiguous state, or `--merge`
attempted from primary/main) — stop and report the printed reason; do not
retry with a guessed target.

**MANDATORY for every subsequent bash block**: start it by finding and
sourcing `quality-load-root.sh` (it lives in the KIT, not necessarily the
audited repo, so `cd`-relative `scripts/quality-load-root.sh` is not
reliable once Step -1 has `cd`'d into the target — use the same
candidate-path search as above):

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done
```

This restores `$GIT_ROOT` and cwd from the Step -1 sentinel, and defines
`bs_quality_root_file` + `bs_quality_find_script` (resolves any OTHER kit
script — plugin, `~/.claude` symlink, submodule, or bare clone — across
every install layout; see the script header for why this must never be
hardcoded to two paths again). Skipping this preamble silently drops target
resolution beyond Step -1.

### Step 0: Parse Arguments

Read `reference.md` for flag definitions. Key flags: `--level` (auto|95|98),
`--scope` (changed|branch|all), `--merge`, `--deploy`, `--preflight`,
`--audit`, `--teams`, `--verify [N]` (adversarial verification, see Step 2.6).
Reviewer selection is shared across both CLIs via the user provider policy at
`${XDG_CONFIG_HOME:-~/.config}/buildproven/agent-providers.json`
(`primary` + `fallback`). Handle
early exits: `--status`, `--preflight` (<10s), `--audit` (read-only).

### Step 0.5: Risk Scoring → Review Depth (`--level auto`)

Review is machine-only and provider-neutral on flat-rate subscriptions, so
cost is wall-clock, not dollars. `--level auto` (default)
computes a 0–100 risk score from `git diff` and scales agent count (2→10)
and Codex effort (skip→xhigh). Discovery is one pass; only accepted findings
can trigger the separate targeted verification round. Logic lives in
`scripts/quality-risk-resolve.sh` — `source` it after the Step -1 preamble.
**Floor invariant: every change gets a real primary-provider review** —
nothing merges with zero machine review.

**Tier → agent + Codex map** (read tier names from
`harness-config.json:riskTierRules` at runtime — never hand-render path
globs in this skill):

| Tier       | Review depth           | Time cap |
| ---------- | ---------------------- | -------- |
| `low`      | focused                | ≤2 min   |
| `medium`   | broad                  | ≤5 min   |
| `high`     | broad + adversarial    | ≤8 min   |
| `critical` | release-veto discovery | ≤10 min  |

Full tier table + agent focus descriptions: `reference.md` "Quality Levels".

### Step 1: Automated Checks

Determine files by scope, run TypeScript/ESLint/build, optional
Trivy/Semgrep/Lighthouse, compute a quality score.

**One absolute deadline owns the whole invocation.** Every blocking subprocess
must run through `quality-run-bounded.sh --governor
"$BS_QUALITY_GOVERNOR_FILE" --cap <stage-cap> --reserve <seconds> -- ...`.
The wrapper clamps the stage to the governor's remaining time. Run independent
checks concurrently where safe. Never grant a stage or fallback a fresh budget.

### Step 1.3: Hard Test Gate (BLOCKING)

Tests must exist and pass — a hard blocker, not advisory (`--skip-tests` for
config-only repos). Implementation (existence check, run+auto-fix loop,
gap reporting) is in `reference.md` "Step 1.3" — the mechanics are
mechanical plumbing, not one of this skill's must-survive gates.

### Step 1.5–1.7: Pattern Analysis, Coverage, Docs Sync

Defensive pattern analysis (`checklist.md`), test-quality scan
(`checklist.md` "Test Quality"), doc-sync check (skip with `--skip-docs`).

### Step 1.8: Select + Run Quality Agents

**Scope `changed`**: skip agents, automated checks suffice. Otherwise, first
build the tier-aware panel (persists to a sentinel — bash arrays don't cross
fenced blocks — and enforces break-glass approval at `critical` tier):

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done
SELECT_AGENTS="$(bs_quality_find_script quality-select-agents.sh)" || {
  echo "❌ MERGE BLOCKED: quality-select-agents.sh not found." >&2; exit 1;
}
source "$SELECT_AGENTS"   # sets AGENTS[], writes the agents sentinel
```

Then: capture diff context (`git diff main...HEAD`, changed files, commit
log) — every agent prompt gets the actual diff, never "run git diff
yourself." Template in `reference.md` "Diff Context Injection".

**Do NOT use the Task tool for review agents.** This skill runs forked; Task
agents are fire-and-forget and their results never arrive inside this
fork's turn, so the merge gate downstream never runs — the #1 way `--merge`
silently failed to complete (confirmed structural, not a prompting issue:
nested Task agents are async too). Review MUST run as a **blocking
subprocess** instead.

**Model:** review agents inherit the session model — never pass `--model`.
Pinning a `*[1m]` model is unconditional and global: it overrides the
operator's session choice and trips the 1M-context Extra Usage billing gate
on non-Opus sessions (session-wide, not model-bound). Run on an Opus session
for the strongest review.

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done

# ROUND GATE — MANDATORY, do not skip, do not "just one more round."
# This is what terminates the outer fix -> re-review loop. Since the MODEL
# orchestrates this loop, a prose cap is not a cap — only a non-zero exit
# here is. If this exits 1, report outstanding findings and STOP.
GOVERNOR="$(bs_quality_find_script quality-run-governor.js)" || {
  echo "❌ MERGE BLOCKED: quality-run-governor.js not found — refusing to run an unbounded review loop." >&2
  exit 1
}
node "$GOVERNOR" bump-round "$BS_QUALITY_GOVERNOR_FILE" || exit 1

# Blocking review subprocess (mechanics in scripts/quality-run-review.sh).
RUNNER="$(bs_quality_find_script quality-run-review.sh)" || {
  echo "❌ MERGE BLOCKED: quality-run-review.sh not found." >&2; exit 1;
}
source "$RUNNER"   # round 1 discovers; round 2 verifies persisted findings against the fix delta
```

Read every `"$REVIEW_OUT"/*.findings.txt` and feed into Step 2.5
synthesis. A file beginning `INCONCLUSIVE:` means that agent timed out,
errored, or didn't parse — treat as **review inconclusive, human required**
(never PASS, never silently dropped); under `--merge`, block until resolved.

### Step 2: Agent Result Validation

Validate outputs per `checklist.md` "Agent Validation" — expected sections,
minimum content length, reject generic responses.

### Step 2.5: Judge — Finding Synthesis (CRITICAL)

Collect all findings (Claude agents + Codex), deduplicate by file:line
(multiple agents flagging the same line = higher confidence), and classify
every finding into exactly one category:

- **BLOCKING** — bugs, security vulns, data loss, breaking changes. Must fix.
- **WARNING** — missing edge cases, perf concerns, weak error handling.
- **SUPPRESSED** — style nits, naming, unchanged-code suggestions. Never shown.

Findings flagged by 2+ independent agents (e.g. Claude + Codex) promote one
severity level. Output a consolidated report (format + rules in
`checklist.md` "Judge Agent Validation"): 0 BLOCKING → PASS; any BLOCKING →
auto-fix → re-run the panel → still BLOCKING → FAIL. **The number of
re-review rounds is not your judgment call** — the round gate above owns it
(default cap 2); a non-zero exit from it is a hard stop, not "just check
once more." An empty report (0/0) is a valid, real outcome — never fabricate
findings.

### Step 2.6: Adversarial Verification (`--verify`, opt-in)

The judge promotes a finding when 2+ agents flag it. But agents reading the same
diff make **correlated** errors — same model, same prompt shape, same blind
spots. "Three agents agreed" can just be the same mistake three times.

`--verify [N]` (default 3) hands every BLOCKING finding to N skeptics whose only
job is to **refute** it. Nobody is asked "is this a bug?" — a question that
invites agreement. They are asked to prove the code is fine. A finding survives
only if they cannot kill it.

```bash
VERIFY="$(bs_quality_find_script quality-adversarial-verify.sh)" || {
  echo "❌ MERGE BLOCKED: quality-adversarial-verify.sh not found — --verify was requested but cannot run." >&2
  exit 1
}
bash "$VERIFY" \
  --findings "$REVIEW_OUT/findings.json" \
  --diff "$DIFF_FILE" \
  --out "$REVIEW_OUT/verify" \
  --voters "${VERIFY_VOTERS:-3}"
```

Then recompute `BLOCKING_COUNT` from the survivors in
`"$REVIEW_OUT/verify/verdicts.json"` (`.verified.survives == true`).

**Asymmetric by design.** A false PASS ships the bug; a false BLOCK costs one fix
round. So every uncertain path lets the finding survive: a tie survives, a
timed-out skeptic survives, malformed input survives (loudly). Silence is not a
refutation. `--verify` can only ever _remove_ findings the skeptics actively
killed — it can never add a pass.

**Before every fix attempt** (not just Codex rounds — this is the loop that
produced 6 and 13 commits across two PRs in one night with nothing bounding
the outer cycle), re-check the governor:

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done
GOVERNOR="$(bs_quality_find_script quality-run-governor.js)" || {
  echo "❌ RUN HALTED: quality-run-governor unavailable before fix attempt" >&2; exit 1;
}
node "$GOVERNOR" check "$BS_QUALITY_GOVERNOR_FILE" || {
  echo "❌ RUN HALTED: budget exceeded before fix attempt — see reference.md \"Run Governor\"." >&2
  echo "   Summarize what was tried, why it didn't converge, and the exact re-invocation" >&2
  echo "   command to raise the cap. Do NOT continue rounds or proceed to --merge." >&2
  exit 1
}
```

Also run `node "$GOVERNOR" record-finding "$BS_QUALITY_GOVERNOR_FILE"
'<findings-json>'` before committing a fix; if `repeated=true`, batch every
matching call site into one commit instead of one round per occurrence.

### Provider fallback

The configured fallback runs only when the primary CLI is immediately
unavailable or returns a typed account-exhaustion response (including HTTP
429/weekly usage limits). A provider timeout is a bounded review failure, not a
reason to start another expensive provider. It never runs merely because the
primary found a bug. Successful round 2 uses one high-effort pass over only the
fix commits plus the persisted findings from round 1.

### Review Stamp

After all agents pass, stamp commit trailers — the **authoritative** record
of what review ran (`.claude/quality-skip-log.json` is telemetry only):

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done

BS_QUALITY_REVIEWSTATE_FILE="${BS_QUALITY_ROOT_FILE%.txt}-reviewstate.env"
[ -f "$BS_QUALITY_REVIEWSTATE_FILE" ] || { echo "❌ MERGE BLOCKED: review evidence state missing." >&2; exit 1; }
. "$BS_QUALITY_REVIEWSTATE_FILE"
[ -f "${BS_QUALITY_ROOT_FILE%.txt}-riskstate.env" ] && . "${BS_QUALITY_ROOT_FILE%.txt}-riskstate.env"
HEAD_SHA="$REVIEWED_HEAD"
BASE_SHA="$REVIEWED_BASE"
TIER_LABEL="${TIER:-L${LEVEL}}"
AGENT_COUNT=${#AGENTS[@]}
FINDING_COUNT=${BLOCKING_COUNT:-0}

echo "Reviewed-By: quality (tier=${TIER_LABEL}, reviewer=${REVIEW_PROVIDER}, primary=${QUALITY_PRIMARY}, fallback=${QUALITY_FALLBACK}, findings=${FINDING_COUNT}, head=${HEAD_SHA}, base=${BASE_SHA})"
echo "Reviewed-By: ${REVIEW_PROVIDER} (tier=${TIER_LABEL}, findings=${FINDING_COUNT}, head=${HEAD_SHA}, base=${BASE_SHA})"

# MUST go through the sentinel below, not a bare shell var — bash vars do NOT
# survive between fenced blocks, so Step 4 (a different block) needs this to
# read anything other than defaults. See reference.md "Regression History".
BS_QUALITY_RUNSTATE_FILE="${BS_QUALITY_ROOT_FILE%.txt}-runstate.env"
cat > "$BS_QUALITY_RUNSTATE_FILE" <<EOF
QUALITY_PIPELINE_RAN=true
TIER='${TIER:-}'
TIER_LABEL='${TIER_LABEL:-}'
LEVEL='${LEVEL:-}'
AGENT_COUNT='${AGENT_COUNT:-0}'
BLOCKING_COUNT='${BLOCKING_COUNT:-0}'
RESOLVED_BASE='${RESOLVED_BASE:-}'
REVIEW_PROVIDER='${REVIEW_PROVIDER:-}'
QUALITY_PRIMARY='${QUALITY_PRIMARY:-}'
QUALITY_FALLBACK='${QUALITY_FALLBACK:-}'
REVIEWED_HEAD='${HEAD_SHA:-}'
REVIEWED_BASE='${BASE_SHA:-}'
EOF
```

Full trailer grammar: `reference.md` "Trailer Convention".

### Step 3: Verification & Commit

Re-run automated checks to confirm fixes, generate a smart commit message.
`--scope changed`: auto-commit and exit. `--scope branch`/`all`: create PR.

### Step 4: Merge & Deploy (`--merge`)

**HARD GATE — Review Trailer Required (NON-NEGOTIABLE).** Before `gh pr
merge`, verify the pipeline actually ran this invocation, and at
high/critical verify the Codex XOR evidence:

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done

# Load Step 2.5's run-state sentinel. Without this, every variable below
# reads empty/default (bash vars don't cross fenced blocks) — the auto-stamp
# branch could never fire and the high/critical XOR gate would silently
# fail OPEN comparing TIER against "". See reference.md "Regression History".
BS_QUALITY_RUNSTATE_FILE="${BS_QUALITY_ROOT_FILE%.txt}-runstate.env"
[ -f "$BS_QUALITY_RUNSTATE_FILE" ] && . "$BS_QUALITY_RUNSTATE_FILE"
BASE_REF="${RESOLVED_BASE:-origin/main}"

# 0. UNRESOLVED BLOCKING FINDINGS BLOCK THE MERGE.
#
#    This gate did not exist until 2026-07-12, and its absence is not theoretical:
#    a review panel returned FAIL with 2 blocking findings, the skill stamped
#    "findings=2" into the trailer, and merged anyway — shipping an
#    install-bricking bug to a public repo. BLOCKING_COUNT was only ever
#    interpolated into the trailer text; it was never compared to anything.
#
#    Every other gate here verifies the review RAN. None verified it PASSED.
#    An attendance register is not an exam.
#
#    Downgrading a finding to WARNING is a judgement call the model may make in
#    Step 2.5 — but it must be made THERE, explicitly, and reflected in the count.
#    It cannot be made implicitly by merging past it.
if [ "${BLOCKING_COUNT:-0}" -ne 0 ]; then
  echo "❌ MERGE BLOCKED: ${BLOCKING_COUNT} unresolved BLOCKING finding(s)." >&2
  echo "   Fix them and re-run, or reclassify them in Step 2.5 with a stated" >&2
  echo "   reason. Do not merge past a failing review." >&2
  exit 1
fi

# 1. Provider-neutral quality trailer required at EVERY tier. If missing but the
#    pipeline ran THIS invocation, auto-stamp via an empty commit (avoids the
#    "quality passed but the last commit lacked the trailer" footgun). If the
#    pipeline did NOT run this invocation, hard-block — auto-stamping then
#    would forge review evidence.
QUALITY_TRAILER=$(git log -1 --format=%B | git interpret-trailers --parse 2>/dev/null | grep -E '^Reviewed-By: quality( |$)' | head -1)
if [ -z "$QUALITY_TRAILER" ]; then
  if [ "${QUALITY_PIPELINE_RAN:-false}" = true ]; then
    git commit --allow-empty -m "chore(quality): stamp review trailer

Reviewed-By: quality (tier=${TIER_LABEL:-${TIER:-L${LEVEL}}}, reviewer=${REVIEW_PROVIDER}, primary=${QUALITY_PRIMARY}, fallback=${QUALITY_FALLBACK}, findings=${BLOCKING_COUNT:-0}, head=${REVIEWED_HEAD}, base=${REVIEWED_BASE})
Reviewed-By: ${REVIEW_PROVIDER} (tier=${TIER_LABEL:-${TIER:-L${LEVEL}}}, findings=${BLOCKING_COUNT:-0}, head=${REVIEWED_HEAD}, base=${REVIEWED_BASE})" \
      || { echo "❌ Failed to create auto-stamp commit — aborting merge"; exit 1; }
    git push || { echo "❌ Failed to push auto-stamp commit — aborting merge"; exit 1; }
  else
    echo "❌ MERGE BLOCKED: No 'Reviewed-By: quality' trailer found, and the"
    echo "   review pipeline did not run in this invocation. Run the full quality loop"
    echo "   (including review agents) before --merge. Do NOT manually add this trailer."
    exit 1
  fi
fi

# 2. Bind evidence to the exact reviewed revision and require the provider
#    trailer to match every authorization field. Executable validator tests
#    cover valid stamps, stale HEADs, and contradictory provider evidence.
VALIDATOR="$(bs_quality_find_script quality-validate-review-trailers.sh)" || {
  echo "❌ MERGE BLOCKED: review-evidence validator missing." >&2; exit 1;
}
bash "$VALIDATOR" "$BASE_REF" || {
  echo "❌ MERGE BLOCKED: quality review evidence is stale, malformed, or contradictory." >&2
  exit 1
}

```

This gate prevents merging when review agents were skipped — by
shortcutting, by error, or by automated-checks-only. No trailer = no merge,
no exceptions.

1. Push branch and create the PR. Prefer `gh pr merge --auto --squash` so
   required CI owns the final merge without keeping the quality session alive.
   If auto-merge is unavailable, any synchronous `gh pr checks --watch` must
   run through `quality-run-bounded.sh` with the same governor. On deadline,
   return `LOCAL_PASS_CI_PENDING`; never silently extend the run.

```bash
FINISH_MERGE="$(bs_quality_find_script quality-finish-merge.sh)" || exit 1
bash "$FINISH_MERGE" --governor "$BS_QUALITY_GOVERNOR_FILE"
```

2. **Worktree-aware cleanup** — run `scripts/quality-merge-cleanup.sh` after
   a successful merge. Leaves the operator on primary `main`, worktree
   removed, branch deleted, refs pruned. Failures here MUST surface (zero
   silent failures) — a partial cleanup leaks state into the next session.
   Without this every merge leaves an orphaned worktree + stale branch.
3. Remind the user to verify deployment health with their normal tooling.

### Step 5: Record Quality History

Update `.qualityrc.json` (score, coverage, duration, cost). Show next-step
suggestions (`reference.md` "Next-Step Suggestions").

## Parallel Sub-Review Mode

`--parallel` fires security/coverage/perf sub-reviews as concurrent acpx
sessions instead of running them sequentially. See `reference.md` "Parallel
Sub-Review Mode" for the full acpx invocation, polling, and fallback.

## Supporting Files

- `reference.md` — flags, scopes, levels, target resolution detail, trailer
  grammar, regression history, acpx parallel mode, run-governor incidents
- `checklist.md` — exit criteria, agent validation rules, scoring, pattern
  categories
- `scripts/quality-bootstrap.sh` — Step -1 target resolution + governor init
- `scripts/quality-load-root.sh` — per-block cwd/root restore (source this)
- `scripts/quality-risk-resolve.sh` — Step 0.5 risk scoring
- `scripts/quality-select-agents.sh` — Step 1.8 panel construction
- `scripts/quality-run-review.sh` — Step 1.8 blocking review subprocess
- `scripts/quality-provider-policy.sh` — cross-CLI primary/fallback policy
- `scripts/quality-review-plan.sh` — tier-equivalent provider depth
- `scripts/quality-run-bounded.sh` — provider process-group timeout
- `scripts/quality-validate-review-trailers.sh` — SHA/provider evidence gate
- `scripts/quality-merge-cleanup.sh` — Step 4 post-merge worktree teardown
- `scripts/quality-finish-merge.sh` — deadline-bound CI/auto-merge orchestration
