#!/usr/bin/env bash
# quality-run-review.sh — Step 1.8 review execution for the quality skill.
#
# Runs the Claude review panel as a BLOCKING subprocess via
# claude-review-companion.sh. Do NOT use the Task tool here: this skill runs
# in a FORKED context, and Task-tool agents are fire-and-forget — their
# results arrive asynchronously as task-notifications to the PARENT session,
# never inside this fork's turn. The fork then hands back ("I'll wait for
# the agents…"), is never re-invoked, and the merge gate downstream of
# review never runs. This was the #1 way `--merge` silently failed to
# complete. It is structural, not a prompting problem — verified empirically:
# nested Task agents are async too, so this also breaks inside Task-agent
# callers like /bs:merge-train.
#
# The round-cap gate (bump-round) is NOT in this script — it is called
# directly from SKILL.md immediately before this script, since it is one of
# the three gates that must survive compaction. This script only does the
# mechanical plumbing around it.
#
# Requires: GIT_ROOT, TMPDIR/session sentinel already set up (source
# quality-load-root.sh first). Writes findings to $REVIEW_OUT and echoes
# REVIEW_OUT=<path> on success.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve the review runner across every install layout (plugin, ~/.claude
# symlink, submodule, bare clone). Before 2026-07-10 this checked exactly two
# paths; on the primary install (~/.claude/scripts -> an overlay repo, which
# never carried this script) BOTH missed, `bash <missing>` returned 127, and
# the skill printed "MERGE BLOCKED: review runner failed (rc=127)" and
# exited — which is the "does all the work then never merges" stall.
COMPANION="$(bs_quality_find_script claude-review-companion.sh)" || {
  echo "❌ MERGE BLOCKED: claude-review-companion.sh not found on any candidate path — review could not run." >&2
  exit 1
}

# Resolve the base ref the same way risk-policy-gate.js does.
REVIEW_BASE=""
for ref in origin/main origin/master main master; do
  if git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
    REVIEW_BASE="$ref"; break
  fi
done
[ -n "$REVIEW_BASE" ] || { echo "❌ MERGE BLOCKED: no base ref for review diff" >&2; exit 1; }

# Read the tier-selected panel from the sentinel quality-select-agents.sh
# wrote — bash arrays don't cross fenced blocks. Empty panel = a bug
# upstream; block, don't skip.
AGENTS_FILE="${TMPDIR:-/tmp}/bs-quality-agents-${CLAUDE_CODE_SESSION_ID:-default}.txt"
AGENTS_CSV="$(paste -sd, "$AGENTS_FILE" 2>/dev/null | sed 's/,*$//')"
if [ -z "$AGENTS_CSV" ]; then
  echo "❌ MERGE BLOCKED: review panel unresolved (no agents sentinel) — review did not run." >&2
  exit 1
fi

REVIEW_OUT="$(mktemp -d "${TMPDIR:-/tmp}/bs-quality-review.XXXXXX")"
git diff "${REVIEW_BASE}...HEAD"            > "$REVIEW_OUT/diff.txt"
git diff --name-only "${REVIEW_BASE}...HEAD" > "$REVIEW_OUT/files.txt"
git log "${REVIEW_BASE}..HEAD" --oneline     > "$REVIEW_OUT/log.txt"

# Do NOT pass --model: review inherits the session model on purpose (pinning
# a *[1m] model trips the Extra Usage billing gate on non-Opus sessions; the
# companion also refuses [1m] defensively).
bash "$COMPANION" \
  --diff-file "$REVIEW_OUT/diff.txt" \
  --files-file "$REVIEW_OUT/files.txt" \
  --log-file "$REVIEW_OUT/log.txt" \
  --out-dir "$REVIEW_OUT" \
  --agents "$AGENTS_CSV" \
  --timeout "${BS_QUALITY_REVIEW_TIMEOUT:-300}"
COMPANION_RC=$?

# FAIL LOUD on ANY non-zero: 2 = claude CLI unavailable, 1 = bad args / no
# agents / unwritable out-dir. Either way review did not run cleanly — a
# missing reviewer is a BLOCKED merge, never a silent pass.
if [ "$COMPANION_RC" -ne 0 ]; then
  case "$COMPANION_RC" in
    2) echo "❌ MERGE BLOCKED: claude CLI unavailable — review could not run." >&2 ;;
    *) echo "❌ MERGE BLOCKED: review runner failed (rc=$COMPANION_RC)." >&2 ;;
  esac
  exit 1
fi

echo "REVIEW_OUT=$REVIEW_OUT"
echo "REVIEW_BASE=$REVIEW_BASE"
