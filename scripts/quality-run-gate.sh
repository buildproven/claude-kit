#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MANIFEST=""
NAME=""
SKIP=false
REASON=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest) MANIFEST="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --skip) SKIP=true; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "quality-run-gate: unknown argument '$1'" >&2; exit 1 ;;
  esac
done
[ -n "$MANIFEST" ] && [ -n "$NAME" ] || {
  echo "quality-run-gate: --manifest and --name are required" >&2
  exit 1
}
if [ "$SKIP" = true ]; then
  [ "$NAME" = test ] && [ -n "$REASON" ] && [ "$#" -eq 0 ] || {
    echo "quality-run-gate: --skip requires --name test, --reason, and no command" >&2
    exit 1
  }
elif [ "$#" -eq 0 ]; then
  :
else
  echo "quality-run-gate: commands are resolved from the persisted gate policy" >&2
  exit 1
fi
ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" locate "$MANIFEST")" || exit 1
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "gate '$NAME'" || exit 1
STATE_ROOT="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" stateRoot)"
HEAD="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" revisions.currentHead)"
if node "$SCRIPT_DIR/quality-invocation.js" gate-satisfied "$MANIFEST" \
  --name "$NAME"; then
  echo "[quality] reusing exact-HEAD gate evidence: $NAME @ $HEAD"
  exit 0
fi
LOG_DIR="$STATE_ROOT/gates/$HEAD"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$NAME.log"
cd "$ROOT" || exit 1
release_terminal_quality_lock() {
  local invocation branch plan primary
  [ "$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" options.merge)" = true ] || return 0
  branch="$(git branch --show-current 2>/dev/null || true)"
  [ -n "$branch" ] || return 0
  invocation="$(node "$SCRIPT_DIR/quality-invocation.js" field "$MANIFEST" invocationId)" || return 0
  plan="$(node "$SCRIPT_DIR/worktree-manager.js" resolve --repo "$ROOT" --branch "$branch" 2>/dev/null)" || return 0
  primary="$(printf '%s' "$plan" | jq -r '.repoRoot // empty' 2>/dev/null)"
  [ -n "$primary" ] && [ "$primary" != "$ROOT" ] || return 0
  node "$SCRIPT_DIR/worktree-manager.js" unlock \
    --repo "$ROOT" --branch "$branch" --owner "bs:quality/$invocation" --terminal \
    >/dev/null 2>&1 || echo "[quality] terminal gate failure left its worktree lock in place; inspect the exact lock owner before recovery." >&2
}
if [ "$SKIP" = true ]; then
  node "$SCRIPT_DIR/quality-invocation.js" gate-run "$MANIFEST" \
    --name "$NAME" --skip --reason "$REASON" || exit 1
  cat "$LOG"
  exit 0
fi
node "$SCRIPT_DIR/quality-invocation.js" gate-run "$MANIFEST" \
  --name "$NAME"
GATE_RC=$?
if [ "$GATE_RC" -ne 0 ]; then
  release_terminal_quality_lock
  node "$SCRIPT_DIR/quality-terminal-status.js" \
    --manifest "$MANIFEST" --category repository-gate --gate "$NAME" || true
  exit "$GATE_RC"
fi
bash "$SCRIPT_DIR/quality-assert-clean.sh" \
  --manifest "$MANIFEST" --phase "gate '$NAME' completion" || exit 1
