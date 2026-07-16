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
#
# Design invariants (each maps to a staff-engineer review finding):
#   - MODEL: never pin a *[1m] model. Inherit by default (omit --model). Only
#     pass --model when the caller supplies a NON-[1m] value. Pinning [1m] on a
#     non-Opus session trips the Extra Usage billing gate.
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
OUT_DIR=""
DRY_RUN=false
REVIEW_MODE=discovery
PRIOR_FINDINGS_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --diff-file)  DIFF_FILE="$2"; shift 2 ;;
    --files-file) FILES_FILE="$2"; shift 2 ;;
    --log-file)   LOG_FILE="$2"; shift 2 ;;
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

if [ -z "$AGENTS" ] || [ -z "$OUT_DIR" ] || [ -z "$DIFF_FILE" ]; then
  echo "claude-review-companion: --agents, --out-dir, --diff-file required" >&2
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
rm -f "$CANCEL_FILE" "$EXHAUSTED_FILE"

# --- MODEL guard: never pin a [1m] variant (Extra Usage billing gate) --------
MODEL_ARGS=()
if [ -n "$MODEL" ]; then
  case "$MODEL" in
    *"[1m]"*|*"-1m"*)
      echo "claude-review-companion: refusing to pin a 1M-context model ($MODEL) — inheriting instead" >&2
      ;;
    *)
      MODEL_ARGS=(--model "$MODEL")
      ;;
  esac
fi

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
  echo "(BLOCKING|WARNING), what's wrong, and the concrete fix. If nothing is"
  echo "wrong, say exactly: NO FINDINGS."
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
run_agent() {
  local agent="$1" sysfile out raw result rc stderr_file error_text reset_detail
  out="$OUT_DIR/${agent##*:}.findings.txt"
  stderr_file="$OUT_DIR/${agent##*:}.stderr"
  if ! sysfile="$(resolve_agent_file "$agent")"; then
    echo "claude-review-companion: agent file for '$agent' not found (kit agents/ or pr-review-toolkit)" >&2
    echo "INCONCLUSIVE: agent definition '$agent' could not be resolved — human review required" > "$out"
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
          --append-system-prompt-file "$sysfile" \
          --permission-mode bypassPermissions \
          --allowedTools "Read,Grep,Glob" \
          ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
          --output-format json 2>>"$stderr_file" )"
  rc=$?

  error_text="$(printf '%s\n' "$raw"; cat "$stderr_file" 2>/dev/null)"
  if printf '%s\n' "$error_text" | grep -Eiq '(^|[^0-9])429([^0-9]|$)|weekly (usage )?limit|usage limit|rate.?limit|quota (exceeded|exhausted)|too many requests'; then
    reset_detail="$(printf '%s\n' "$error_text" | grep -Ei 'reset|429|weekly (usage )?limit|usage limit|rate.?limit|quota' | head -1 | tr '\n' ' ')"
    printf 'Claude provider exhausted%s\n' "${reset_detail:+: $reset_detail}" > "$EXHAUSTED_FILE"
    : > "$CANCEL_FILE"
    echo "INCONCLUSIVE: Claude provider exhausted${reset_detail:+ — $reset_detail}" > "$out"
    return 75
  fi

  if [ -f "$CANCEL_FILE" ]; then
    echo "INCONCLUSIVE: agent '$agent' cancelled because a sibling reported provider exhaustion" > "$out"
    return 78
  fi

  if [ $rc -ne 0 ] || [ -z "$raw" ]; then
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
exhausted=false
for pid in "${pids[@]}"; do
  wait "$pid"
  rc=$?
  if [ "$rc" -eq 75 ]; then
    exhausted=true
  elif [ "$rc" -ne 0 ]; then
    inconclusive=$((inconclusive + 1))
  fi
done

if [ "$exhausted" = true ] || [ -f "$EXHAUSTED_FILE" ]; then
  cat "$EXHAUSTED_FILE" >&2 2>/dev/null || true
  echo "claude-review-companion: cancelled sibling reviewers; fallback may run immediately" >&2
  exit 75
fi

echo "claude-review-companion: wrote findings for $resolved agent(s) to $OUT_DIR ($inconclusive inconclusive)" >&2
if [ "$inconclusive" -ge "$resolved" ]; then
  echo "claude-review-companion: ALL $resolved agent(s) inconclusive — review degraded" >&2
  exit 4
fi
exit 0
