#!/usr/bin/env bash
# backlog-post-merge.sh - Close every Linear issue cited by a merged change.
#
# Run locally from a post-merge hook or from .github/workflows/linear-post-merge.yml.
# In Actions, GitHub's commit-to-pull-request endpoint contributes the PR body so
# bundled fixes can cite more than one issue with `Closes BUI-123, BUI-456`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

fail() {
  echo "[backlog-post-merge] ERROR: $*" >&2
  exit 1
}

extract_linear_ids() {
  # Identifiers are intentionally prefix-agnostic: public users should not need
  # to fork this script just because their Linear team key is not BUI or CS.
  grep -Eo '[A-Z]{2,}-[0-9]+' | sort -u
}

github_pr_bodies() {
  if [[ -z "${GITHUB_REPOSITORY:-}" || -z "${GITHUB_SHA:-}" ]]; then
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    echo "[backlog-post-merge] WARN: gh is unavailable; using commit text only" >&2
    return 0
  fi

  gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/pulls" \
    --jq '.[].body // empty' 2>/dev/null || {
      echo "[backlog-post-merge] WARN: could not read associated PR bodies; using commit text only" >&2
      return 0
    }
}

collect_linear_ids() {
  local source_text
  if [[ -n "${ITEM_ID_OVERRIDE:-}" ]]; then
    printf '%s\n' "$ITEM_ID_OVERRIDE" | extract_linear_ids
    return 0
  fi

  source_text="$(git -C "$GIT_ROOT" log -1 --format='%s%n%b')"
  source_text+=$'\n'
  source_text+="$(github_pr_bodies)"
  printf '%s\n' "$source_text" | extract_linear_ids
}

linear_graphql() {
  local query="$1"
  curl -fsS \
    -H "Content-Type: application/json" \
    -H "Authorization: $LINEAR_API_KEY" \
    --data "$(jq -cn --arg query "$query" '{query: $query}')" \
    "https://api.linear.app/graphql"
}

LINEAR_API_KEY="${LINEAR_API_KEY:-}"
if [[ -z "$LINEAR_API_KEY" && -f "$GIT_ROOT/.env" ]]; then
  LINEAR_API_KEY="$(awk -F= '/^LINEAR_API_KEY=/{sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit}' "$GIT_ROOT/.env")"
fi

mapfile -t ITEM_IDS < <(collect_linear_ids)
if [[ ${#ITEM_IDS[@]} -eq 0 ]]; then
  echo "[backlog-post-merge] No Linear issue identifiers found; nothing to update"
  exit 0
fi

if [[ -z "$LINEAR_API_KEY" ]]; then
  fail "LINEAR_API_KEY is required to close: ${ITEM_IDS[*]}. Add it as a repository Actions secret."
fi

DONE_STATE_ID="$(linear_graphql '{ workflowStates(filter: { type: { eq: "completed" } }) { nodes { id } } }' \
  | jq -r '.data.workflowStates.nodes[0].id // empty')"
[[ -n "$DONE_STATE_ID" ]] || fail "could not find a completed Linear workflow state"

for item_id in "${ITEM_IDS[@]}"; do
  issue_id="$(linear_graphql "{ issues(filter: { identifier: { eq: \\\"$item_id\\\" } }) { nodes { id } } }" \
    | jq -r '.data.issues.nodes[0].id // empty')"
  if [[ -z "$issue_id" ]]; then
    echo "[backlog-post-merge] WARN: $item_id was not found in Linear; skipping" >&2
    continue
  fi

  result="$(linear_graphql "mutation { issueUpdate(id: \\\"$issue_id\\\", input: { stateId: \\\"$DONE_STATE_ID\\\" }) { success } }" \
    | jq -r '.data.issueUpdate.success // false')"
  if [[ "$result" == "true" ]]; then
    echo "[backlog-post-merge] Marked $item_id as Done"
  else
    fail "Linear rejected the update for $item_id"
  fi
done
