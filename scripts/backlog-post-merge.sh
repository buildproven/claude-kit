#!/usr/bin/env bash
# backlog-post-merge.sh - Auto-complete Linear issues when their branch is merged
# Installed as: .git/hooks/post-merge (optional) or called by GitHub Actions
# Detects CS-NNN from branch name → marks Linear issue as Done

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

# Find ISSUE_PREFIX-NNN pattern from recently merged branch name via reflog
# Set ISSUE_PREFIX env var to match your Linear workspace prefix (default: CS)
ISSUE_PREFIX="${ISSUE_PREFIX:-CS}"
MERGED_BRANCH=$(git reflog --format='%gs' -1 | grep -oE "${ISSUE_PREFIX}-[0-9]+" | head -1 || true)

if [[ -z "$MERGED_BRANCH" ]]; then
  MERGED_BRANCH=$(git log --format='%s %b' -1 | grep -oE "${ISSUE_PREFIX}-[0-9]+" | head -1 || true)
fi

if [[ -z "$MERGED_BRANCH" ]]; then
  exit 0  # No ${ISSUE_PREFIX}-NNN found — not a backlog item branch
fi

ITEM_ID="$MERGED_BRANCH"

# Allow override via environment (for manual testing)
if [[ -n "${ITEM_ID_OVERRIDE:-}" ]]; then
  ITEM_ID="$ITEM_ID_OVERRIDE"
fi

echo "[backlog-post-merge] Detected merged item: $ITEM_ID"

# Require LINEAR_API_KEY
LINEAR_API_KEY="${LINEAR_API_KEY:-}"
if [[ -z "$LINEAR_API_KEY" ]]; then
  # Try loading from .env
  ENV_FILE="${GIT_ROOT}/.env"
  if [[ -f "$ENV_FILE" ]]; then
    LINEAR_API_KEY=$(grep -E '^LINEAR_API_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)
  fi
fi

if [[ -z "$LINEAR_API_KEY" ]]; then
  echo "[backlog-post-merge] LINEAR_API_KEY not set — skipping Linear update"
  exit 0
fi

# Find the Linear issue by identifier (e.g. CS-164 for ISSUE_PREFIX=CS)
ISSUE_ID=$(curl -s \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d "{\"query\": \"{ issues(filter: { identifier: { eq: \\\"$ITEM_ID\\\" } }) { nodes { id identifier state { id name } } } }\"}" \
  "https://api.linear.app/graphql" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); nodes=d['data']['issues']['nodes']; print(nodes[0]['id'] if nodes else '')" 2>/dev/null || true)

if [[ -z "$ISSUE_ID" ]]; then
  echo "[backlog-post-merge] Linear issue $ITEM_ID not found — skipping"
  exit 0
fi

# Find the "Done" state for this team
DONE_STATE_ID=$(curl -s \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d '{"query": "{ workflowStates(filter: { name: { eq: \"Done\" } }) { nodes { id name team { name } } } }"}' \
  "https://api.linear.app/graphql" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); nodes=d['data']['workflowStates']['nodes']; print(nodes[0]['id'] if nodes else '')" 2>/dev/null || true)

if [[ -z "$DONE_STATE_ID" ]]; then
  echo "[backlog-post-merge] Could not find 'Done' state in Linear — skipping"
  exit 0
fi

# Update the issue state to Done
RESULT=$(curl -s \
  -H "Content-Type: application/json" \
  -H "Authorization: $LINEAR_API_KEY" \
  -d "{\"query\": \"mutation { issueUpdate(id: \\\"$ISSUE_ID\\\", input: { stateId: \\\"$DONE_STATE_ID\\\" }) { success issue { identifier state { name } } } }\"}" \
  "https://api.linear.app/graphql" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); u=d['data']['issueUpdate']; print('success' if u['success'] else 'failed')" 2>/dev/null || echo "error")

if [[ "$RESULT" == "success" ]]; then
  echo "[backlog-post-merge] ✅ Marked $ITEM_ID as Done in Linear"
else
  echo "[backlog-post-merge] ⚠️ Failed to update $ITEM_ID in Linear: $RESULT"
fi
