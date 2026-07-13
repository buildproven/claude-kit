#!/usr/bin/env bash
# quality-codex-review.sh — Step 2.6 Codex cross-review for the quality
# skill. Tier-aware: skipped at low, judge mode at medium, judge+adversarial
# at high/critical. Runs the adversarial pass as a backgrounded Codex job and
# polls it to a terminal state, bounded by the run-governor at every wait
# iteration.
#
# Requires (already set by the caller before sourcing/invoking): GIT_ROOT,
# TIER, LEVEL, CODEX_DEPTH, CODEX_ROUNDS, CODEX_EFFORT, NO_CODEX,
# CODEX_SKIP_REASON, CLAUDE_FINDINGS, BS_QUALITY_GOVERNOR_FILE.
#
# Sets on exit (when sourced): CODEX_MODE, CODEX_VERDICT, CODEX_FINDINGS,
# RESOLVED_BASE.
#
# The XOR check that CONSUMES this script's result (Reviewed-By: codex vs.
# Quality-Skip trailer) lives in SKILL.md Step 4 — that gate must survive
# compaction, so it is not delegated here. This script only produces the
# evidence that gate checks for.
set -u

# Resolve base the same way risk-policy-gate.js does (origin/main -> origin/master -> main -> master).
RESOLVED_BASE=""
for ref in origin/main origin/master main master; do
  if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
    RESOLVED_BASE="$ref"; break
  fi
done
if [ -z "$RESOLVED_BASE" ]; then
  echo "❌ No resolvable base ref for Codex; pass --no-codex or set --base manually"
  exit 1
fi

# Codex depth is score-driven (primary). The score's CODEX_DEPTH is one of
# skip|medium|high|xhigh and CODEX_ROUNDS is how many adversarial passes to
# run. Map those onto the existing judge / judge+adversarial modes. When no
# score is present (fallback), derive from $TIER/$LEVEL as before.
COMPANION=""
for candidate in \
  "${CLAUDE_PLUGIN_ROOT:-}/scripts/codex-companion.mjs" \
  "$HOME/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/codex-companion.mjs" \
  "$HOME/.claude/scripts/codex-companion.mjs"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    COMPANION="$candidate"; break
  fi
done
if [ -z "$COMPANION" ]; then
  CODEX_SKIP_REASON="codex-companion.mjs not found at any known path"
fi

if [ -n "${CODEX_DEPTH:-}" ]; then
  case "$CODEX_DEPTH" in
    skip)              CODEX_SELECTOR="low" ;;
    medium)            CODEX_SELECTOR="medium"; CODEX_EFFORT="${CODEX_EFFORT:-medium}" ;;
    high)               CODEX_SELECTOR="high";   CODEX_EFFORT="${CODEX_EFFORT:-high}" ;;
    xhigh)              CODEX_SELECTOR="high";   CODEX_EFFORT="${CODEX_EFFORT:-xhigh}" ;;
    *)                  CODEX_SELECTOR="high";   CODEX_EFFORT="${CODEX_EFFORT:-high}" ;;
  esac
else
  CODEX_EFFORT="${CODEX_EFFORT:-high}"
  CODEX_SELECTOR="${TIER:-$LEVEL}"
fi
CODEX_ROUNDS="${CODEX_ROUNDS:-1}"

case "$CODEX_SELECTOR" in
  low)
    CODEX_MODE="skip"
    ;;
  medium|95)
    # Judge mode — pass Claude findings as focus text to adversarial-review.
    # Foreground (--wait), bounded by companion's wall-time cap.
    CODEX_MODE="judge"
    if [ "${NO_CODEX:-false}" != true ] && [ -z "${CODEX_SKIP_REASON:-}" ]; then
      node "$COMPANION" adversarial-review --wait --base "$RESOLVED_BASE" --scope branch \
        "Judge the following Claude findings for accuracy, actionability, and false-positive risk. \
         Approve, request-changes, or flag specific findings as low-confidence. Findings: ${CLAUDE_FINDINGS:-}"
    fi
    ;;
  high|critical|98)
    # Judge + adversarial. Background for adversarial; bounded poll to terminal state.
    # Score-driven CODEX_ROUNDS: run up to N adversarial passes. Round 2+ is a
    # re-verification after auto-fixes from round 1; it only runs if the prior
    # round found something. The total is bounded by CODEX_DEADLINE.
    CODEX_MODE="judge+adversarial"
    CODEX_VERDICT="not-run"
    CODEX_FINDINGS=0
    if [ "${NO_CODEX:-false}" != true ] && [ -z "${CODEX_SKIP_REASON:-}" ]; then
      ROUND=1
      GOVERNOR="$(bs_quality_find_script quality-run-governor.js || true)"
      while [ "$ROUND" -le "${CODEX_ROUNDS:-1}" ]; do
        [ "$ROUND" -gt 1 ] && echo "[quality] Codex re-verification round $ROUND/${CODEX_ROUNDS}..."

        # FAIL CLOSED when the governor script or sentinel can't be located —
        # see reference.md "Run Governor" for the 2026-07-03 incident this
        # guards against. A silently-skipped check here lets the loop run
        # unbounded with zero visible warning.
        if [ -z "$GOVERNOR" ] || [ ! -f "$GOVERNOR" ] || [ ! -f "${BS_QUALITY_GOVERNOR_FILE:-/nonexistent}" ]; then
          echo "❌ RUN HALTED: quality-run-governor unavailable before Codex round $ROUND" >&2
          echo "   (script=${GOVERNOR:-<not found>}, sentinel=${BS_QUALITY_GOVERNOR_FILE:-<unset>})." >&2
          echo "   The runaway-loop circuit breaker cannot run, so this loop cannot be bounded." >&2
          echo "   Fix the governor script path or re-run Step -1 to regenerate the sentinel." >&2
          exit 1
        fi
        GOVERNOR_CHECK_FILE="${BS_QUALITY_GOVERNOR_FILE%.json}-check.json"
        node "$GOVERNOR" status "$BS_QUALITY_GOVERNOR_FILE"
        if ! node "$GOVERNOR" check "$BS_QUALITY_GOVERNOR_FILE" > "$GOVERNOR_CHECK_FILE" 2>&1; then
          echo "❌ RUN HALTED: quality-run-governor budget exceeded (or sentinel unreadable) before Codex round $ROUND."
          cat "$GOVERNOR_CHECK_FILE"
          echo ""
          echo "   This is an operator handback, not a merge block on this code's quality —"
          echo "   the autonomous loop reached round $ROUND without converging, OR the governor"
          echo "   sentinel became unreadable mid-run (fails closed by design). Summarize what"
          echo "   has been tried and what remains, then STOP."
          echo "   Do NOT continue rounds, do NOT proceed to --merge. Raise the caps explicitly"
          echo "   (BS_QUALITY_MAX_FIX_COMMITS / BS_QUALITY_MAX_WALL_SECONDS) only if the operator"
          echo "   re-invokes with that intent."
          exit 1
        fi

        LAUNCH_OUT=$(node "$COMPANION" adversarial-review --background --base "$RESOLVED_BASE" --scope branch \
          "Adversarial review focused on bugs, security, data loss, race conditions, breaking changes. \
           Effort: $CODEX_EFFORT. Verdict: APPROVE or REQUEST_CHANGES with file:line findings." 2>&1)
        CODEX_JOB=$(echo "$LAUNCH_OUT" | grep -oE 'Job [0-9a-f-]+' | head -1 | awk '{print $2}')

        if [ -z "$CODEX_JOB" ]; then
          echo "❌ Failed to obtain Codex job id from launcher output."
          exit 1
        fi

        # Bounded poll: 25-min cap matches the spec's high/critical time cap.
        # ALSO re-check the run-governor's wall-clock budget every iteration —
        # without this, a run that trips its wall-clock cap 1s into this poll
        # could still wait out the full ~25min DEADLINE before the next
        # governor check (2026-07-03 finding: default 30min cap + 25min Codex
        # deadline meant a run at 29m59s could continue toward ~55min).
        DEADLINE=${CODEX_DEADLINE:-600}
        WAITED=0
        while [ "$WAITED" -lt "$DEADLINE" ]; do
          STATUS=$(node "$COMPANION" status "$CODEX_JOB" --json 2>/dev/null | jq -r '.status // "unknown"')
          case "$STATUS" in
            completed|succeeded|failed|cancelled|timed-out) break ;;
          esac
          if [ -z "$GOVERNOR" ] || [ ! -f "$GOVERNOR" ] || [ ! -f "${BS_QUALITY_GOVERNOR_FILE:-/nonexistent}" ]; then
            echo "❌ RUN HALTED: governor became unavailable mid-poll (script=${GOVERNOR:-<not found>}, sentinel=${BS_QUALITY_GOVERNOR_FILE:-<unset>})." >&2
            echo "   Cannot enforce the wall-clock cap for the remainder of this poll — halting" >&2
            echo "   rather than silently waiting out the full DEADLINE unbounded." >&2
            node "$COMPANION" cancel "$CODEX_JOB" >/dev/null 2>&1 || true
            exit 1
          fi
          if ! node "$GOVERNOR" check "$BS_QUALITY_GOVERNOR_FILE" > /dev/null 2>&1; then
            echo "❌ RUN HALTED: quality-run-governor budget tripped while waiting on Codex job $CODEX_JOB." >&2
            echo "   Cancelling the in-flight job and handing back — this is the same operator" >&2
            echo "   handback as a pre-round trip, just detected mid-poll instead of before launch." >&2
            node "$COMPANION" cancel "$CODEX_JOB" >/dev/null 2>&1 || true
            exit 1
          fi
          sleep 15; WAITED=$((WAITED + 15))
        done

        if [ "$STATUS" != "completed" ] && [ "$STATUS" != "succeeded" ]; then
          echo "❌ Codex review did not complete (status=$STATUS, waited=${WAITED}s)."
          echo "   Re-run, raise CODEX_DEADLINE, or use --codex-skip \"<reason>\"."
          exit 1
        fi

        CODEX_OUT=$(node "$COMPANION" result "$CODEX_JOB" --json 2>/dev/null)
        CODEX_VERDICT=$(echo "$CODEX_OUT" | jq -r '.verdict // .status // "unknown"' 2>/dev/null)
        CODEX_FINDINGS=$(echo "$CODEX_OUT" | jq -r '(.findings // []) | length' 2>/dev/null || echo 0)

        # Repeated-pattern detection (2026-07-03 guardrail): if this round's
        # findings mostly repeat a shape from an earlier round (e.g. the same
        # on-disk-vs-loaded gap at 4 call sites), tell the fixer to batch-fix
        # every occurrence in one commit rather than spending a round each —
        # that's what turned PR #532 into 13 commits.
        if [ -n "$GOVERNOR" ] && [ -f "$GOVERNOR" ] && [ -f "${BS_QUALITY_GOVERNOR_FILE:-/nonexistent}" ]; then
          FINDINGS_JSON=$(echo "$CODEX_OUT" | jq -c '[(.findings // [])[] | {file: (.file // ""), summary: (.summary // .title // .message // "")}]' 2>/dev/null || echo '[]')
          # Capture stdout/stderr SEPARATELY (2026-07-04 fix): the governor
          # writes its warning to stderr while emitting valid JSON on stdout
          # for the degraded-but-handled case. Merging them with 2>&1 broke
          # `jq -e .` parsing even when stdout alone was valid.
          PATTERN_STDERR_FILE=$(mktemp "${TMPDIR:-/tmp}/bs-quality-pattern-stderr.XXXXXX")
          PATTERN_OUT=$(node "$GOVERNOR" record-finding "$BS_QUALITY_GOVERNOR_FILE" "$FINDINGS_JSON" 2>"$PATTERN_STDERR_FILE")
          PATTERN_STDERR=$(cat "$PATTERN_STDERR_FILE" 2>/dev/null)
          rm -f "$PATTERN_STDERR_FILE"
          if [ -n "$PATTERN_STDERR" ]; then
            echo "⚠️  [quality] governor record-finding: $PATTERN_STDERR" >&2
          fi
          if ! echo "$PATTERN_OUT" | jq -e . >/dev/null 2>&1; then
            echo "⚠️  [quality] governor record-finding produced no usable JSON (non-fatal, but repeated-pattern detection is degraded this round)" >&2
            PATTERN_OUT='{"repeated":false}'
          fi
          PATTERN_REPEATED=$(echo "$PATTERN_OUT" | jq -r '.repeated // false' 2>/dev/null)
          if [ "$PATTERN_REPEATED" = "true" ]; then
            PATTERN_SHAPE=$(echo "$PATTERN_OUT" | jq -r '.shape // "unknown"' 2>/dev/null)
            PATTERN_MATCH=$(echo "$PATTERN_OUT" | jq -r '.matchCount // 0' 2>/dev/null)
            echo "⚠️  [quality] Repeated-pattern detected: ${PATTERN_MATCH} findings this round share a shape"
            echo "    already seen in a prior round (\"${PATTERN_SHAPE}\"). Fix ALL matching call sites"
            echo "    in ONE commit now — do not spend a separate round per occurrence."
          fi
        fi

        # Fail-closed on REQUEST_CHANGES — operator must address or --codex-skip.
        case "$CODEX_VERDICT" in
          request-changes|REQUEST_CHANGES|needs-attention|fail|failed)
            echo "❌ Codex adversarial review: $CODEX_VERDICT ($CODEX_FINDINGS findings)"
            echo "   Address findings, or re-run with --codex-skip \"<reason>\" if accepted."
            exit 1
            ;;
        esac

        # Clean pass → no need for further rounds.
        if [ "${CODEX_FINDINGS:-0}" -eq 0 ]; then break; fi
        ROUND=$((ROUND + 1))
      done
    fi
    ;;
  *)
    CODEX_MODE="skip"
    ;;
esac

echo "CODEX_MODE=${CODEX_MODE:-skip}"
echo "CODEX_VERDICT=${CODEX_VERDICT:-}"
echo "CODEX_FINDINGS=${CODEX_FINDINGS:-0}"
echo "RESOLVED_BASE=$RESOLVED_BASE"
