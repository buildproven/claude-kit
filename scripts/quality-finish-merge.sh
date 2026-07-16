#!/usr/bin/env bash
# Complete or arm a PR merge without escaping the quality run's deadline.
set -u

GOVERNOR_FILE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --governor) GOVERNOR_FILE="$2"; shift 2 ;;
    *) echo "usage: quality-finish-merge.sh --governor <file>" >&2; exit 2 ;;
  esac
done
[ -n "$GOVERNOR_FILE" ] && [ -f "$GOVERNOR_FILE" ] || {
  echo "quality-finish-merge: readable --governor required" >&2
  exit 2
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOUNDED="$SCRIPT_DIR/quality-run-bounded.sh"
[ -f "$BOUNDED" ] || {
  echo "quality-finish-merge: quality-run-bounded.sh missing" >&2
  exit 1
}
command -v gh >/dev/null 2>&1 || {
  echo "quality-finish-merge: gh CLI unavailable" >&2
  exit 1
}

run_gh() {
  local cap="$1"
  local reserve="$2"
  shift 2
  bash "$BOUNDED" --governor "$GOVERNOR_FILE" \
    --cap "$cap" --reserve "$reserve" -- gh "$@"
}

run_gh 30 120 pr merge --auto --squash
AUTO_RC=$?
if [ "$AUTO_RC" -eq 0 ]; then
  PR_STATE="$(run_gh 15 90 pr view --json state --jq .state)"
  VIEW_RC=$?
  if [ "$VIEW_RC" -eq 124 ]; then
    echo "LOCAL_PASS_CI_PENDING: shared deadline reached while confirming auto-merge state."
    exit 0
  fi
  [ "$VIEW_RC" -eq 0 ] || exit "$VIEW_RC"
  if [ "$PR_STATE" != MERGED ]; then
    echo "LOCAL_PASS_CI_PENDING: auto-merge armed; required CI owns completion."
  fi
  exit 0
fi
if [ "$AUTO_RC" -eq 124 ]; then
  echo "LOCAL_PASS_CI_PENDING: shared deadline reached while arming auto-merge."
  exit 0
fi

run_gh 300 60 pr checks --watch
CHECKS_RC=$?
if [ "$CHECKS_RC" -eq 124 ]; then
  echo "LOCAL_PASS_CI_PENDING: shared deadline reached before CI completed."
  exit 0
fi
if [ "$CHECKS_RC" -ne 0 ]; then
  echo "❌ MERGE BLOCKED: CI failed or could not be observed (rc=$CHECKS_RC)." >&2
  exit "$CHECKS_RC"
fi

run_gh 45 0 pr merge --squash
MERGE_RC=$?
if [ "$MERGE_RC" -eq 124 ]; then
  echo "LOCAL_PASS_CI_PENDING: shared deadline reached during final merge."
  exit 0
fi
exit "$MERGE_RC"
