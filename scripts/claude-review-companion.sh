#!/usr/bin/env bash
# claude-review-companion.sh — run Claude code-review agents as BLOCKING
# subprocesses, so review is synchronous in every context the quality skill
# runs in (forked skill, Task agent, interactive main loop).
#
# WHY THIS EXISTS (see docs / the 2026-07-01 investigation):
#   The quality skill spawns review via the Task tool. Task-tool agents are
#   fire-and-forget: their results arrive asynchronously as notifications to
#   the PARENT session. A forked skill therefore CANNOT block on them, so the
#   merge gate downstream of review never runs. Empirically confirmed:
#   nested Task agents are async too. The ONLY review mechanism synchronous
#   in ALL three contexts is a blocking subprocess — the same reason the
#   Codex leg works everywhere. This is that mechanism for Claude review.
#
# Each agent runs as `claude -p` with the REAL agent body appended as its
# system prompt (resolved from the agent .md files at runtime — single source
# of truth, no drift). Findings are written per-agent to $OUT_DIR; the caller
# synthesizes them (Step 2.5).
#
# Usage:
#   claude-review-companion.sh --diff-file <f> --files-file <f> --log-file <f> \
#       --out-dir <d> --agents "code-reviewer,silent-failure-hunter" \
#       [--timeout 600] [--model <m>]
#
# Exit codes:
#   0  every agent produced a findings file (some may be INCONCLUSIVE)
#   1  bad args / no agents resolved / OUT_DIR unwritable
#   2  the `claude` CLI is unavailable (caller must fail LOUD, never skip review)
#   75 Claude account quota/rate limit exhausted (safe to invoke fallback)
#   79 Claude billing/credits unavailable (safe to invoke fallback)
#
# Design invariants (each maps to a staff-engineer review finding):
#   - MODEL: always pin a non-*\[1m\] review model. Inheriting the parent session
#     can silently fan a 1M-context model out across every review agent;
#     pinning a 1M variant can also trip the Extra Usage billing gate.
#   - FIDELITY: use the real agent .md bodies via --append-system-prompt-file,
#     never inlined summaries. Missing agent file => loud failure, not silent
#     panel-shrink.
#   - RECURSION: export BS_QUALITY_HEADLESS=1 to every child so the skill
#     hard-refuses if a review path ever re-enters /bs:quality.
#   - JSON: a child that can't be parsed/timed-out is marked INCONCLUSIVE
#     (loud, human-required) — never a silent PASS, never a hard crash that
#     takes the whole merge down.
#   - TIMEOUT: portable via perl alarm (macOS has no `timeout`).

set -u

TIMEOUT=600
MODEL=""
AGENTS=""
DIFF_FILE=""
FILES_FILE=""
LOG_FILE=""
IDENTITY_FILE=""
OUT_DIR=""
DRY_RUN=false
REVIEW_MODE=discovery
PRIOR_FINDINGS_FILE=""
RISK_TIER=""
REVIEW_FOCUS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --diff-file)  DIFF_FILE="$2"; shift 2 ;;
    --files-file) FILES_FILE="$2"; shift 2 ;;
    --log-file)   LOG_FILE="$2"; shift 2 ;;
    --identity-file) IDENTITY_FILE="$2"; shift 2 ;;
    --out-dir)    OUT_DIR="$2"; shift 2 ;;
    --agents)     AGENTS="$2"; shift 2 ;;
    --timeout)    TIMEOUT="$2"; shift 2 ;;
    --model)      MODEL="$2"; shift 2 ;;
    --review-mode) REVIEW_MODE="$2"; shift 2 ;;
    --prior-findings-file) PRIOR_FINDINGS_FILE="$2"; shift 2 ;;
    --tier) RISK_TIER="$2"; shift 2 ;;
    --focus) REVIEW_FOCUS="$2"; shift 2 ;;
    # --dry-run: validate args, apply guards, resolve agent files, and write a
    # DRY-RUN marker per agent — but DO NOT call `claude`. For fast, no-token
    # unit tests of the guard/degradation paths.
    --dry-run)    DRY_RUN=true; shift ;;
    *) echo "claude-review-companion: unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$AGENTS" ] || [ -z "$OUT_DIR" ] || [ -z "$DIFF_FILE" ] || [ -z "$IDENTITY_FILE" ] || [ -z "$RISK_TIER" ] || [ -z "$REVIEW_FOCUS" ]; then
  echo "claude-review-companion: --agents, --out-dir, --diff-file, --identity-file, --tier, --focus required" >&2
  exit 1
fi
if [ "$REVIEW_MODE" = verification ] &&
   { [ -z "$PRIOR_FINDINGS_FILE" ] || [ ! -f "$PRIOR_FINDINGS_FILE" ]; }; then
  echo "claude-review-companion: verification requires --prior-findings-file" >&2
  exit 1
fi

# --- CLI availability: fail LOUD (exit 2), the caller must NOT skip review ----
# (Skipped under --dry-run, which never calls claude.)
if [ "$DRY_RUN" != true ] && ! command -v claude >/dev/null 2>&1; then
  echo "claude-review-companion: \`claude\` CLI not found — cannot run review" >&2
  exit 2
fi

mkdir -p "$OUT_DIR" 2>/dev/null || { echo "claude-review-companion: cannot create OUT_DIR $OUT_DIR" >&2; exit 1; }
CANCEL_FILE="$OUT_DIR/provider-cancel"
EXHAUSTED_FILE="$OUT_DIR/provider-exhausted"
FAILURE_FILE="$OUT_DIR/provider-failure.json"
rm -f "$CANCEL_FILE" "$EXHAUSTED_FILE" "$FAILURE_FILE"

# --- MODEL policy: never inherit or pin a [1m] variant -----------------------
# Review agents receive a bounded, revision-specific diff and prompt. They do
# not need to inherit the operator's long-context session, which would turn a
# single 1M session into a costly panel-wide fan-out. Keep the default explicit
# so the effective model is stable and visible in the child CLI invocation.
DEFAULT_REVIEW_MODEL="claude-sonnet-5"
EFFECTIVE_MODEL="${MODEL:-$DEFAULT_REVIEW_MODEL}"
case "$EFFECTIVE_MODEL" in
  *"[1m]"*|*"-1m"*)
    echo "claude-review-companion: refusing 1M-context review model ($EFFECTIVE_MODEL) — using $DEFAULT_REVIEW_MODEL" >&2
    EFFECTIVE_MODEL="$DEFAULT_REVIEW_MODEL"
    ;;
esac

# --- resolve an agent name to its .md system-prompt file ---------------------
# Search order: kit-local agents/, then the pr-review-toolkit plugin. The
# CLAUDE_PLUGIN_ROOT / kit root are resolved relative to this script.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
KIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PLUGIN_AGENTS_GLOB="$HOME/.claude/plugins/marketplaces/*/plugins/pr-review-toolkit/agents"
REVIEW_SCHEMA_FILE="$SCRIPT_DIR/schemas/quality-review-output.schema.json"
if [ ! -f "$REVIEW_SCHEMA_FILE" ]; then
  echo "claude-review-companion: review schema not found: $REVIEW_SCHEMA_FILE" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "claude-review-companion: jq is required to load the review schema" >&2
  exit 1
fi
# Claude Code validates the schema natively, but its bundled validator rejects
# the Draft 2020 metadata URI. Keep the shared schema canonical and remove only
# that annotation at this provider boundary.
if ! REVIEW_SCHEMA_JSON="$(jq -c 'del(."$schema")' "$REVIEW_SCHEMA_FILE" 2>/dev/null)"; then
  echo "claude-review-companion: review schema is invalid JSON: $REVIEW_SCHEMA_FILE" >&2
  exit 1
fi

resolve_agent_file() {
  local name="$1"
  # strip an optional plugin prefix like "pr-review-toolkit:silent-failure-hunter"
  name="${name##*:}"
  if [ -f "$KIT_ROOT/agents/$name.md" ]; then
    echo "$KIT_ROOT/agents/$name.md"; return 0
  fi
  for dir in $PLUGIN_AGENTS_GLOB; do
    if [ -f "$dir/$name.md" ]; then
      echo "$dir/$name.md"; return 0
    fi
  done
  return 1
}

# --- build the shared review context prompt ----------------------------------
CTX_FILE="$OUT_DIR/review-context.txt"
{
  echo "Review ONLY the following diff. Do NOT scan unchanged code."
  echo "Review mode: $REVIEW_MODE"
  echo "Risk tier: $RISK_TIER"
  echo "Review focus: $REVIEW_FOCUS"
  if [ "$REVIEW_MODE" = verification ]; then
    echo
    echo "## Prior findings to verify"
    cat "$PRIOR_FINDINGS_FILE"
    echo
    echo "Verify every prior finding is fixed and check the fix for regressions."
  fi
  echo
  echo "## Repository and revision identity"
  cat "$IDENTITY_FILE"
  echo
  echo "## Changed files"
  [ -f "$FILES_FILE" ] && cat "$FILES_FILE"
  echo
  echo "## Commit log"
  [ -f "$LOG_FILE" ] && cat "$LOG_FILE"
  echo
  echo "## Diff"
  cat "$DIFF_FILE"
  echo
  echo "Return only material findings. The quality runner supplies and validates"
  echo "the structured review schema; do not add a prose report outside it."
  echo "The verdict MUST be approve when findings is empty and MUST be"
  echo "needs-attention when findings contains one or more items."
} > "$CTX_FILE"

# --- hard timeout that actually kills ----------------------------------------
# Replaces `perl -e 'alarm shift; exec @ARGV'` (2026-07-10). `alarm` schedules
# SIGALRM for the *perl* process, but `exec` REPLACES that process with claude —
# so the signal lands on a process that may ignore it, and any grandchildren
# (claude's own tool subprocesses) are never signalled at all. Result: reviews
# that hung for the full wall-clock and gated the whole panel on `wait`.
#
# This runs the child in its own process group (set -m) and, on expiry, kills
# the entire group: TERM, grace, then KILL. Nothing survives it.
run_with_timeout() {
  local secs="$1"; shift
  local child_pid watchdog_pid rc

  set -m                       # own process group for the child
  "$@" &
  child_pid=$!
  set +m

  (
    waited=0
    while [ "$waited" -lt "$secs" ] && [ ! -f "$CANCEL_FILE" ]; do
      sleep 1
      waited=$((waited + 1))
    done
    # Negative PID = the whole process group, so claude's children die too.
    kill -TERM "-${child_pid}" 2>/dev/null || kill -TERM "$child_pid" 2>/dev/null
    sleep 1
    kill -KILL "-${child_pid}" 2>/dev/null || kill -KILL "$child_pid" 2>/dev/null
  ) &
  watchdog_pid=$!

  wait "$child_pid"; rc=$?
  kill "$watchdog_pid" 2>/dev/null   # completed in time — retire the watchdog
  wait "$watchdog_pid" 2>/dev/null || true
  return $rc
}

# --- run one agent as a blocking subprocess ----------------------------------
# Writes the agent's .result (final answer) to $OUT_DIR/<agent>.md, or an
# INCONCLUSIVE marker.
record_structured_failure() {
  local evidence="$1" failure_json category reset_at temporary
  failure_json="$(node "$SCRIPT_DIR/quality-provider-error.js" describe "$evidence")" ||
    return 1
  category="$(printf '%s' "$failure_json" | jq -r '.category')"
  reset_at="$(printf '%s' "$failure_json" |
    jq -r '.resetAt // "time unavailable"')"
  temporary="${FAILURE_FILE}.$$.$RANDOM.tmp"
  printf '%s' "$failure_json" |
    jq '. + {provider: "claude"}' > "$temporary" || return 1
  mv "$temporary" "$FAILURE_FILE"
  case "$category" in
    provider-exhaustion)
      printf 'Claude provider exhausted (structured error metadata; reset %s)\n' \
        "$reset_at" > "$EXHAUSTED_FILE"
      return 75
      ;;
    provider-billing)
      printf 'Claude provider billing or credits unavailable (structured error metadata)\n' \
        > "$EXHAUSTED_FILE"
      return 79
      ;;
    *) return 1 ;;
  esac
}

run_agent() {
  local agent="$1" slot_model="$2" sysfile out raw rc stderr_file error_json failure_rc
  local normalized_file salvage_warning enriched_file
  out="$OUT_DIR/${agent##*:}.findings.txt"
  stderr_file="$OUT_DIR/${agent##*:}.stderr"
  if ! sysfile="$(resolve_agent_file "$agent")"; then
    # Loud and specific (BUI-461): a missing agent DEFINITION is a different
    # failure than a timeout or parse error — it means review coverage is
    # silently reduced, possibly for the whole panel run, not just this one
    # attempt. Name both search locations so the fix is obvious: either the
    # agent .md belongs in kit-local agents/, or the pr-review-toolkit plugin
    # (which supplies agents like code-simplifier) isn't installed/updated in
    # this environment.
    echo "claude-review-companion: WARNING — agent definition for '$agent' UNRESOLVED." >&2
    echo "claude-review-companion:   searched: $KIT_ROOT/agents/${agent##*:}.md" >&2
    echo "claude-review-companion:   searched: $PLUGIN_AGENTS_GLOB/${agent##*:}.md" >&2
    echo "claude-review-companion:   review coverage for this agent is DEGRADED (not silently skipped — this run is marked INCONCLUSIVE)." >&2
    echo "claude-review-companion:   fix: add the .md to kit agents/, or install/update the pr-review-toolkit plugin." >&2
    echo "INCONCLUSIVE: agent definition '$agent' could not be resolved (searched $KIT_ROOT/agents/ and $PLUGIN_AGENTS_GLOB) — human review required" > "$out"
    return 3
  fi

  # --dry-run: prove resolution + guards without spending tokens.
  if [ "$DRY_RUN" = true ]; then
    echo "DRY-RUN: would review with agent '$agent' (system prompt: $sysfile)" > "$out"
    return 0
  fi

  # Blocking claude -p under a watchdog that can actually kill it.
  #
  # NO TOOLS (`claude --help`: use "" to disable all built-in tools). The full
  # diff, changed files, commit log, and revision identity
  # are already in the prompt. Even read-only tools let reviewers ignore that
  # bounded evidence, explore the repository for dozens of turns, rerun tests,
  # and hit the timeout without returning a verdict. Force a single bounded
  # reasoning turn; deterministic gates already prove repository behavior.
  #
  # Critical's second slot uses a different Claude model family. The effective
  # model is written into each normalized, hash-inventoried result.
  raw="$(run_with_timeout "$TIMEOUT" \
        env BS_QUALITY_HEADLESS=1 \
        claude -p "$(cat "$CTX_FILE")" \
          --no-session-persistence \
          --append-system-prompt-file "$sysfile" \
          --permission-mode bypassPermissions \
          --tools "" \
          --json-schema "$REVIEW_SCHEMA_JSON" \
          --model "$slot_model" \
          --output-format json 2>>"$stderr_file" )"
  rc=$?
  printf '%s\n' "$raw" > "$OUT_DIR/${agent##*:}.result.json"

  # Generated review text is untrusted content, not provider telemetry. Only a
  # non-zero process status plus structured API/CLI error metadata can classify
  # account exhaustion. A successful review may legitimately discuss HTTP 429
  # or quota-handling code and must remain successful.
  error_json="$OUT_DIR/${agent##*:}.error-metadata.json"
  if printf '%s' "$raw" | jq -e . > "$error_json" 2>/dev/null; then
    record_structured_failure "$error_json"
    failure_rc=$?
    if [ "$failure_rc" -eq 75 ] || [ "$failure_rc" -eq 79 ]; then
      : > "$CANCEL_FILE"
      echo "INCONCLUSIVE: Claude provider failed with typed category" > "$out"
      return "$failure_rc"
    fi
  fi
  if [ "$rc" -ne 0 ] && [ -s "$stderr_file" ]; then
    record_structured_failure "$stderr_file"
    failure_rc=$?
    if [ "$failure_rc" -eq 75 ] || [ "$failure_rc" -eq 79 ]; then
      : > "$CANCEL_FILE"
      echo "INCONCLUSIVE: Claude provider failed with typed category" > "$out"
      return "$failure_rc"
    fi
  fi

  if [ -f "$CANCEL_FILE" ]; then
    echo "INCONCLUSIVE: agent '$agent' cancelled because a sibling reported a provider failure" > "$out"
    return 78
  fi

  if [ -z "$raw" ]; then
    echo "INCONCLUSIVE: agent '$agent' timed out or errored (rc=$rc) — human review required" > "$out"
    return 3
  fi

  # The watchdog can deliver TERM in the narrow interval after Claude has
  # emitted a complete JSON result but before this shell reaps it. Preserve
  # that revision-bound evidence only when the envelope itself proves normal
  # completion; a non-zero exit with partial/error output remains fail-closed.
  if [ "$rc" -ne 0 ] && ! printf '%s' "$raw" | jq -e '
    .is_error != true and (.structured_output | type) == "object" and
    (.terminal_reason == "completed" or
      (.terminal_reason == null and .stop_reason == "end_turn"))
  ' >/dev/null 2>&1; then
    echo "INCONCLUSIVE: agent '$agent' timed out or errored (rc=$rc) — human review required" > "$out"
    return 3
  fi
  if [ "$rc" -ne 0 ]; then
    salvage_warning="claude-review-companion: WARNING — preserved a complete structured envelope despite process rc=$rc"
    echo "$salvage_warning" >> "$stderr_file"
    echo "$salvage_warning" >&2
  fi

  # Claude Code validates --json-schema before emitting structured_output.
  # Retain a local semantic check as well: the verdict must agree with whether
  # findings exist. Contradictory evidence must not become either a false pass
  # or a content-free blocking result.
  normalized_file="$OUT_DIR/${agent##*:}.normalized.json"
  if ! printf '%s' "$raw" | jq -e '
    select(.is_error != true and (.structured_output | type) == "object")
    | .structured_output
    | select(
        (.summary | type) == "string" and
        (.summary | test("\\S")) and
        (.findings | type) == "array" and
        all(.findings[];
          (.severity | type) == "string" and
          (.title | type) == "string" and (.title | test("\\S")) and
          (.body | type) == "string" and (.body | test("\\S")) and
          (.failure_scenario | type) == "string" and (.failure_scenario | test("\\S")) and
          (.file | type) == "string" and (.file | test("\\S")) and
          (.line_start | type) == "number" and
          (.line_start | floor) == .line_start and .line_start >= 1 and
          (.recommendation | type) == "string" and
          (.recommendation | test("\\S")) and
          (.proof | type) == "object" and
          (.proof.kind == "reproduction" or .proof.kind == "regression-test" or .proof.kind == "static-analysis") and
          (.proof.evidence | type) == "string" and (.proof.evidence | test("\\S"))
        ) and
        (
          (.verdict == "approve" and (.findings | length) == 0) or
          (.verdict == "needs-attention" and (.findings | length) > 0)
        )
      )
  ' > "$normalized_file" 2>/dev/null; then
    rm -f "$normalized_file"
    : > "$OUT_DIR/provider-contract-failed"
    echo "INCONCLUSIVE: agent '$agent' structured output was missing or contradictory — human review required" > "$out"
    return 3
  fi
  enriched_file="$normalized_file.slot"
  if ! jq --arg role "${agent##*:}" --arg provider claude \
    --arg model "$slot_model" \
    '. + {_qualitySlot: {role: $role, provider: $provider, model: $model}}' \
    "$normalized_file" > "$enriched_file"; then
    rm -f "$normalized_file" "$enriched_file"
    echo "INCONCLUSIVE: agent '$agent' slot identity could not be bound" > "$out"
    return 3
  fi
  mv "$enriched_file" "$normalized_file"

  if ! jq -r '
    if (.findings | length) == 0 then
      "NO FINDINGS. Verdict: \(.verdict). \(.summary)"
    else
      .findings[]
      | "\(.severity): \(.file):\(.line_start) — \(.title)\n\(.body)\nScenario: \(.failure_scenario)\nProof (\(.proof.kind)): \(.proof.evidence)\nFix: \(.recommendation)"
    end
  ' "$normalized_file" > "$out"; then
    echo "INCONCLUSIVE: agent '$agent' structured output could not be rendered — human review required" > "$out"
    return 3
  fi
  return 0
}

# --- run all agents concurrently as background jobs, then wait ---------------
# Bash `wait` blocks the caller's Bash tool call synchronously in every context.
pids=()
mandatory=0
slot_index=0
IFS=',' read -ra AGENT_LIST <<< "$AGENTS"
for agent in "${AGENT_LIST[@]}"; do
  agent="$(printf '%s' "$agent" | tr -d '[:space:]')"
  [ -z "$agent" ] && continue
  mandatory=$((mandatory + 1))
  slot_model="$EFFECTIVE_MODEL"
  if [ "$RISK_TIER" = critical ] && [ "$slot_index" -eq 1 ]; then
    case "$EFFECTIVE_MODEL" in
      *opus*) slot_model="claude-sonnet-5" ;;
      *) slot_model="claude-opus-5" ;;
    esac
  fi
  run_agent "$agent" "$slot_model" &
  pids+=("$!")
  slot_index=$((slot_index + 1))
done

if [ "$mandatory" -eq 0 ]; then
  echo "claude-review-companion: no agents to run" >&2
  exit 1
fi

# Collect each agent's rc. run_agent returns 3 for INCONCLUSIVE (timeout /
# error / unparseable / unresolved). Every selected reviewer must return usable
# evidence. Provider-level retry/fallback owns transient availability; a
# partially completed panel is never restated as a complete review.
inconclusive=0
unresolved_agents=()
provider_failure_rc=0
for pid in "${pids[@]}"; do
  wait "$pid"
  rc=$?
  if [ "$rc" -eq 75 ] || [ "$rc" -eq 79 ]; then
    provider_failure_rc="$rc"
  elif [ "$rc" -ne 0 ]; then
    inconclusive=$((inconclusive + 1))
  fi
done

# Cross-check findings files for the specific "could not be resolved" marker
# (BUI-461) so the campaign-visible summary line names WHICH agents are
# missing a definition entirely, distinct from ordinary timeouts/parse
# errors — a reader shouldn't have to open per-agent findings files to learn
# that review coverage is silently down an agent.
for f in "$OUT_DIR"/*.findings.txt; do
  [ -f "$f" ] || continue
  if grep -q "could not be resolved" "$f" 2>/dev/null; then
    unresolved_agents+=("$(basename "$f" .findings.txt)")
  fi
done
if [ "${#unresolved_agents[@]}" -gt 0 ]; then
  echo "claude-review-companion: WARNING — ${#unresolved_agents[@]} agent(s) have NO resolvable definition (kit agents/ nor pr-review-toolkit plugin): ${unresolved_agents[*]}" >&2
fi

if [ "$provider_failure_rc" -ne 0 ] || [ -f "$EXHAUSTED_FILE" ]; then
  cat "$EXHAUSTED_FILE" >&2 2>/dev/null || true
  echo "claude-review-companion: cancelled sibling reviewers; fallback may run immediately" >&2
  [ "$provider_failure_rc" -ne 0 ] || provider_failure_rc=75
  exit "$provider_failure_rc"
fi

echo "claude-review-companion: wrote findings for $mandatory mandatory agent(s) to $OUT_DIR ($inconclusive inconclusive)" >&2
usable=$((mandatory - inconclusive))
required_usable=$mandatory
if [ "$usable" -lt "$required_usable" ]; then
  echo "claude-review-companion: only $usable/$mandatory mandatory agents produced usable evidence (need $required_usable) — checkpoint blocked" >&2
  exit 4
fi
exit 0
