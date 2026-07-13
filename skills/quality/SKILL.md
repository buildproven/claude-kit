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
`--audit`, `--teams`, `--codex-effort` (medium|high|xhigh), `--codex-skip
"<reason>"`. Handle early exits: `--status`, `--preflight` (<10s), `--audit`
(read-only).

### Step 0.5: Risk Scoring → Review Depth (`--level auto`)

Review is machine-only (Claude finds, Codex verifies) on flat-rate
subscriptions, so cost is wall-clock, not dollars. `--level auto` (default)
computes a 0–100 risk score from `git diff` and scales agent count (2→10),
Codex effort (skip→xhigh), and Codex rounds (0→2) to it. Logic lives in
`scripts/quality-risk-resolve.sh` — `source` it after the Step -1 preamble.
**Floor invariant: every change gets ≥2 Claude agents** — nothing merges
with zero machine review.

**Tier → agent + Codex map** (read tier names from
`harness-config.json:riskTierRules` at runtime — never hand-render path
globs in this skill):

| Tier       | Claude agents                                 | Codex role          | Time cap |
| ---------- | --------------------------------------------- | ------------------- | -------- |
| `low`      | 2 (code-reviewer + silent-failure-hunter)     | skip                | ≤2 min   |
| `medium`   | 4 (+ type-design-analyzer + security-auditor) | judge findings      | ≤8 min   |
| `high`     | 6 (full L95)                                  | judge + adversarial | ≤25 min  |
| `critical` | 6 + `break-glass-approval`                    | judge + adversarial | ≤25 min  |

Full tier table + agent focus descriptions: `reference.md` "Quality Levels".

### Step 1: Automated Checks

Determine files by scope, run TypeScript/ESLint/build, optional
Trivy/Semgrep/Lighthouse, compute a quality score.

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
source "$RUNNER"   # sets REVIEW_OUT, REVIEW_BASE; exits non-zero on any review failure
```

Read every `"$REVIEW_OUT"/<agent>.findings.txt` and feed into Step 2.5
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

### Step 2.6: Codex Cross-Review (tier-aware)

Second-opinion review via a different model. Skipped at `low`, judge mode at
`medium`, judge+adversarial at `high`/`critical`. Disable with `--no-codex`
or skip this run with `--codex-skip "<reason>"`. Full polling/backoff
mechanics (background job, bounded poll, repeated-pattern detection) are in
`scripts/quality-codex-review.sh` — `source` it after the Step -1 preamble;
it sets `CODEX_MODE`, `CODEX_VERDICT`, `CODEX_FINDINGS`, `RESOLVED_BASE`.

**Failure modes** (asymmetric by tier — full table in `reference.md`):
Codex unavailable → skip+warn at low/medium, **block** at high/critical
until `--codex-skip "<reason>"`. BLOCKING findings after judge → always
block. `--codex-skip` → allowed at low/medium; at high/critical requires a
non-empty reason and is logged.

### Review Stamp + Quality-Skip Trailer

After all agents pass, stamp commit trailers — the **authoritative** record
of what review ran (`.claude/quality-skip-log.json` is telemetry only):

```bash
for c in "${CLAUDE_PLUGIN_ROOT:-}/scripts/quality-load-root.sh" \
         "${CLAUDE_KIT_ROOT:-}/scripts/quality-load-root.sh" \
         "$HOME/.claude/scripts/quality-load-root.sh" \
         "./scripts/quality-load-root.sh"; do
  [ -n "$c" ] && [ -f "$c" ] && { source "$c"; break; }
done

HEAD_SHA=$(git rev-parse HEAD)
BASE_SHA=$(git merge-base HEAD "$RESOLVED_BASE")
TIER_LABEL="${TIER:-L${LEVEL}}"
AGENT_COUNT=${#AGENTS[@]}
FINDING_COUNT=${BLOCKING_COUNT:-0}

echo "Reviewed-By: claude-quality (tier=${TIER_LABEL}, agents=${AGENT_COUNT}, findings=${FINDING_COUNT})"

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
CODEX_MODE='${CODEX_MODE:-skip}'
CODEX_VERDICT='${CODEX_VERDICT:-}'
CODEX_SKIP_REASON='${CODEX_SKIP_REASON:-}'
EOF

if [ "$CODEX_MODE" != "skip" ] && [ -z "$CODEX_SKIP_REASON" ] && [ "$NO_CODEX" != true ]; then
  echo "Reviewed-By: codex (tier=${TIER_LABEL}, mode=${CODEX_MODE}, status=${CODEX_VERDICT:-unknown}, findings=${CODEX_FINDINGS:-0})"
fi

if [ -n "$CODEX_SKIP_REASON" ] && { [ "$TIER" = high ] || [ "$TIER" = critical ]; }; then
  echo "Quality-Skip: codex-judge (reason=\"${CODEX_SKIP_REASON}\"; head=${HEAD_SHA}; base=${BASE_SHA})"
fi
```

Full telemetry-log append + trailer grammar: `reference.md` "Trailer
Convention". CI checks the `Reviewed-By: claude-quality` trailer — see
`harness-gate.yml`.

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

# 1. Reviewed-By: claude-quality required at EVERY tier. If missing but the
#    pipeline ran THIS invocation, auto-stamp via an empty commit (avoids the
#    "quality passed but the last commit lacked the trailer" footgun). If the
#    pipeline did NOT run this invocation, hard-block — auto-stamping then
#    would forge review evidence.
if ! git log "${BASE_REF}..HEAD" --format=%B | grep -q "Reviewed-By: claude-quality"; then
  if [ "${QUALITY_PIPELINE_RAN:-false}" = true ]; then
    git commit --allow-empty -m "chore(quality): stamp review trailer

Reviewed-By: claude-quality (tier=${TIER_LABEL:-${TIER:-L${LEVEL}}}, agents=${AGENT_COUNT:-0}, findings=${BLOCKING_COUNT:-0})" \
      || { echo "❌ Failed to create auto-stamp commit — aborting merge"; exit 1; }
    git push || { echo "❌ Failed to push auto-stamp commit — aborting merge"; exit 1; }
  else
    echo "❌ MERGE BLOCKED: No 'Reviewed-By: claude-quality' trailer found, and the"
    echo "   review pipeline did not run in this invocation. Run the full quality loop"
    echo "   (including review agents) before --merge. Do NOT manually add this trailer."
    exit 1
  fi
fi

# 2. High/critical: require EITHER a real Codex trailer OR a verified
#    Quality-Skip trailer (non-empty reason, SHAs matching HEAD/HEAD~1 + merge-base
#    — a stale trailer from an older commit cannot authorize a new merge).
#    XOR, not OR: both present is ambiguous (which is authoritative?), neither
#    is unauthorized. Full SHA-verification logic: reference.md "Trailer
#    Convention" (mirrors harness-gate.yml's check).
if [ "$TIER" = "high" ] || [ "$TIER" = "critical" ]; then
  HAS_CODEX=false
  git log "${BASE_REF}..HEAD" --format=%B | grep -q "^Reviewed-By: codex" && HAS_CODEX=true
  HAS_SKIP=false
  SKIP_TRAILER=$(git log "${BASE_REF}..HEAD" --format=%B | grep "^Quality-Skip:" | tail -1)
  if [ -n "$SKIP_TRAILER" ]; then
    SKIP_HEAD=$(echo "$SKIP_TRAILER" | grep -oE 'head=[a-f0-9]+' | cut -d= -f2)
    SKIP_BASE=$(echo "$SKIP_TRAILER" | grep -oE 'base=[a-f0-9]+' | cut -d= -f2)
    SKIP_REASON=$(echo "$SKIP_TRAILER" | grep -oE 'reason="[^"]*"' | sed 's/reason="//;s/"$//')
    CURRENT_HEAD=$(git rev-parse HEAD)
    CURRENT_HEAD_PARENT=$(git rev-parse HEAD~1 2>/dev/null || true)
    CURRENT_BASE=$(git merge-base HEAD "$BASE_REF")
    if { [ "$SKIP_HEAD" = "$CURRENT_HEAD" ] || [ "$SKIP_HEAD" = "$CURRENT_HEAD_PARENT" ]; } \
       && [ "$SKIP_BASE" = "$CURRENT_BASE" ] \
       && [ -n "$(echo "$SKIP_REASON" | tr -d '[:space:]')" ]; then
      HAS_SKIP=true
    fi
  fi
  if [ "$HAS_CODEX" = false ] && [ "$HAS_SKIP" = false ]; then
    echo "❌ MERGE BLOCKED: tier=$TIER requires a 'Reviewed-By: codex' trailer OR a"
    echo "   verified 'Quality-Skip: codex-judge' trailer with a non-empty reason. Neither found."
    exit 1
  fi
  if [ "$HAS_CODEX" = true ] && [ "$HAS_SKIP" = true ]; then
    echo "❌ MERGE BLOCKED: tier=$TIER has BOTH trailers — exactly one is authoritative. Drop the stale one."
    exit 1
  fi
fi
```

This gate prevents merging when review agents were skipped — by
shortcutting, by error, or by automated-checks-only. No trailer = no merge,
no exceptions.

1. Push branch, create PR (`gh pr create`), wait for CI (unless
   `--skip-ci`), auto-merge (`gh pr merge --squash`).
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
- `scripts/quality-codex-review.sh` — Step 2.6 Codex polling loop
- `scripts/quality-merge-cleanup.sh` — Step 4 post-merge worktree teardown
