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

while [ $# -gt 0 ]; do
  case "$1" in
    --diff-file)  DIFF_FILE="$2"; shift 2 ;;
    --files-file) FILES_FILE="$2"; shift 2 ;;
    --log-file)   LOG_FILE="$2"; shift 2 ;;
    --out-dir)    OUT_DIR="$2"; shift 2 ;;
    --agents)     AGENTS="$2"; shift 2 ;;
    --timeout)    TIMEOUT="$2"; shift 2 ;;
    --model)      MODEL="$2"; shift 2 ;;
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

# --- CLI availability: fail LOUD (exit 2), the caller must NOT skip review ----
# (Skipped under --dry-run, which never calls claude.)
if [ "$DRY_RUN" != true ] && ! command -v claude >/dev/null 2>&1; then
  echo "claude-review-companion: \`claude\` CLI not found — cannot run review" >&2
  exit 2
fi

mkdir -p "$OUT_DIR" 2>/dev/null || { echo "claude-review-companion: cannot create OUT_DIR $OUT_DIR" >&2; exit 1; }

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

# --- run one agent as a blocking subprocess ----------------------------------
# perl alarm = portable timeout (macOS has no `timeout`). Writes the agent's
# .result (final answer) to $OUT_DIR/<agent>.md, or an INCONCLUSIVE marker.
run_agent() {
  local agent="$1" sysfile out raw result rc
  out="$OUT_DIR/${agent##*:}.findings.txt"
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

  # Blocking claude -p. perl alarm enforces the wall-time cap portably.
  raw="$(perl -e 'alarm shift; exec @ARGV' "$TIMEOUT" \
        env BS_QUALITY_HEADLESS=1 \
        claude -p "$(cat "$CTX_FILE")" \
          --append-system-prompt-file "$sysfile" \
          --permission-mode bypassPermissions \
          --allowedTools "Read,Grep,Glob,Bash" \
          "${MODEL_ARGS[@]}" \
          --output-format json 2>>"$OUT_DIR/${agent##*:}.stderr" )"
  rc=$?

  if [ $rc -ne 0 ] || [ -z "$raw" ]; then
    echo "INCONCLUSIVE: agent '$agent' timed out or errored (rc=$rc) — human review required" > "$out"
    return 3
  fi

  # Extract the CLI envelope's .result (verified schema). If jq/parse fails,
  # mark inconclusive rather than crash the whole merge.
  if result="$(printf '%s' "$raw" | jq -r 'if .is_error == true then empty else .result end' 2>/dev/null)" \
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

for pid in "${pids[@]}"; do
  wait "$pid"
done

echo "claude-review-companion: wrote findings for $resolved agent(s) to $OUT_DIR" >&2
exit 0
