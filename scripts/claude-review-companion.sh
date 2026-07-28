#!/usr/bin/env bash
# claude-review-companion.sh — run Claude code-review agents as BLOCKING
# subprocesses, so review is synchronous in every context the quality skill
# runs in (forked skill, Task agent, interactive main loop).
#
# WHY THIS EXISTS (see docs / the 2026-07-01 investigation):
#   The quality skill spawns review via the Task tool. Task-tool agents are
#   fire-and-forget: their results arrive asynchronously as notifications to
#   the PARENT session. A forked skill — and a Task agent (e.g. merge-train
#   runs /bs:quality inside one) — therefore CANNOT block on them, so the
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
    # --dry-run: validate args, apply guards, resolve agent files, and write a
    # DRY-RUN marker per agent — but DO NOT call `claude`. For fast, no-token
    # unit tests of the guard/degradation paths.
    --dry-run)    DRY_RUN=true; shift ;;
    *) echo "claude-review-companion: unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$AGENTS" ] || [ -z "$OUT_DIR" ] || [ -z "$DIFF_FILE" ] || [ -z "$IDENTITY_FILE" ]; then
  echo "claude-review-companion: --agents, --out-dir, --diff-file, --identity-file required" >&2
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
MODEL_ARGS=(--model "$EFFECTIVE_MODEL")

# --- resolve an agent name to its .md system-prompt file ---------------------
# Search order: kit-local agents/, then the pr-review-toolkit plugin. The
# CLAUDE_PLUGIN_ROOT / kit root are resolved relative to this script.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
KIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PLUGIN_AGENTS_GLOB="$HOME/.claude/plugins/marketplaces/*/plugins/pr-review-toolkit/agents"

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
  echo "Return your findings as a concise list. For each: file:line, severity"
  echo "(BLOCKING|WARNING), what's wrong, and the concrete fix."
  echo
  echo "End your entire response with exactly one of these two lines, and"
  echo "nothing else on that line — no punctuation, no extra words:"
  echo '  <<<NO FINDINGS>>>'
  echo "if there is nothing to report, or:"
  echo '  <<<FINDINGS REPORTED>>>'
  echo "if you listed at least one finding above. Any discussion, rationale,"
  echo "or commentary belongs BEFORE this final delimited line, never inside"
  echo "or after it — the delimiter itself must never appear anywhere else"
  echo "in your response, including when explaining what it means."
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
  local agent="$1" sysfile out raw result rc stderr_file error_json failure_rc
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
  # NO Bash IN --allowedTools (2026-07-10). The full diff is already in the
  # prompt; a reviewer has nothing legitimate to execute. With Bash +
  # bypassPermissions, reviewers would run `npm test`/builds/repo-wide greps and
  # burn the entire timeout — that is the "code-reviewer hangs ~10min" symptom,
  # and since the panel joins on `wait`, ONE such agent held the whole run
  # hostage. Read/Grep/Glob is everything a diff review needs.
  #
  # NOTE: "${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"}" is the bash-3.2-safe expansion
  # for a possibly-empty array under `set -u` (macOS /bin/bash 3.2 treats a
  # bare "${arr[@]}" on an empty array as an unbound-variable fatal error).
  raw="$(run_with_timeout "$TIMEOUT" \
        env BS_QUALITY_HEADLESS=1 \
        claude -p "$(cat "$CTX_FILE")" \
          --no-session-persistence \
          --append-system-prompt-file "$sysfile" \
          --permission-mode bypassPermissions \
          --allowedTools "Read,Grep,Glob" \
          ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
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
    .is_error != true and .result != null and
    (.terminal_reason == "completed" or
      (.terminal_reason == null and .stop_reason == "end_turn"))
  ' >/dev/null 2>&1; then
    echo "INCONCLUSIVE: agent '$agent' timed out or errored (rc=$rc) — human review required" > "$out"
    return 3
  fi

  # Extract the CLI envelope's .result (verified schema). Reject is_error AND a
  # null .result (an aborted/tool-exhausted turn returns {is_error:false,
  # result:null}; `jq -r` would print the literal "null" and pass a non-empty
  # check — a silent empty "review"). If jq/parse fails or result is null/empty,
  # mark INCONCLUSIVE rather than crash the merge or fake a clean review.
  if result="$(printf '%s' "$raw" | jq -r 'if (.is_error == true) or (.result == null) then empty else .result end' 2>/dev/null)" \
     && [ -n "$result" ]; then
    # A bare "findings reported" delimiter is malformed, not a finding and
    # not a successful review. Detect it at the producer boundary so the
    # companion returns its existing inconclusive status; otherwise the later
    # judge correctly rejects the artifact but cannot retry an already-recorded
    # review checkpoint for the same HEAD.
    if printf '%s\n' "$result" | awk '
      { lines[NR] = $0; if ($0 ~ /[^[:space:]]/) last = NR }
      END {
        if (!last || lines[last] != "<<<FINDINGS REPORTED>>>") exit 1
        for (i = 1; i < last; i++) {
          if (lines[i] ~ /[^[:space:]]/) exit 1
        }
        exit 0
      }
    '; then
      # Preserve a typed signal alongside the raw provider envelope. The
      # caller may spend one separately governor-authorized panel retry only
      # when every selected agent has this exact malformed-output shape.
      cp "$OUT_DIR/${agent##*:}.result.json" \
        "$OUT_DIR/${agent##*:}.marker-only.result.json"
      jq -n \
        --arg agent "$agent" \
        --arg artifact "${agent##*:}.marker-only.result.json" \
        '{agent: $agent, category: "marker-only-findings", artifact: $artifact}' \
        > "$OUT_DIR/${agent##*:}.marker-only.json"
      echo "INCONCLUSIVE: agent '$agent' reported findings without finding text — human review required" > "$out"
      return 3
    fi
    printf '%s\n' "$result" > "$out"
    return 0
  fi
  echo "INCONCLUSIVE: agent '$agent' output could not be parsed — human review required" > "$out"
  return 3
}

# --- run all agents concurrently as background jobs, then wait ---------------
# Bash `wait` blocks the caller's Bash tool call synchronously in every context.
pids=()
resolved=0
IFS=',' read -ra AGENT_LIST <<< "$AGENTS"
for agent in "${AGENT_LIST[@]}"; do
  agent="$(printf '%s' "$agent" | tr -d '[:space:]')"
  [ -z "$agent" ] && continue
  resolved=$((resolved + 1))
  run_agent "$agent" &
  pids+=("$!")
done

if [ "$resolved" -eq 0 ]; then
  echo "claude-review-companion: no agents to run" >&2
  exit 1
fi

# Collect each agent's rc. run_agent returns 3 for INCONCLUSIVE (timeout /
# error / unparseable / unresolved). If EVERY agent went inconclusive, the whole
# review is degraded — exit 4 so the caller can block the merge rather than
# treat "N inconclusive files" as a clean pass.
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

echo "claude-review-companion: wrote findings for $resolved agent(s) to $OUT_DIR ($inconclusive inconclusive)" >&2
if [ "$inconclusive" -gt 0 ]; then
  echo "claude-review-companion: $inconclusive mandatory agent(s) inconclusive — checkpoint blocked" >&2
  exit 4
fi
exit 0
