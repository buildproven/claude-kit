#!/usr/bin/env bash
# Read-only convergence audit for one local repository.
set -uo pipefail

REPO="${1:-}"
[ -d "$REPO" ] || { echo "audit-repo: repository path required" >&2; exit 2; }
REPO=$(cd "$REPO" && pwd -P)

branch=$(git -C "$REPO" branch --show-current 2>/dev/null || true)
default=main
git -C "$REPO" rev-parse --verify main >/dev/null 2>&1 || default=master
dirty_count=$(git -C "$REPO" status --porcelain=v1 2>/dev/null | wc -l | tr -d ' ')
git -C "$REPO" fetch --prune --quiet 2>/dev/null || true
counts=$(git -C "$REPO" rev-list --left-right --count "$default...origin/$default" 2>/dev/null || echo "0 0")
ahead=$(printf '%s\n' "$counts" | awk '{print $1}')
behind=$(printf '%s\n' "$counts" | awk '{print $2}')
open_prs=0
if command -v gh >/dev/null 2>&1; then
  remote=$(git -C "$REPO" remote get-url origin 2>/dev/null || true)
  slug=$(printf '%s\n' "$remote" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
  if [ -n "$slug" ]; then
    open_prs=$(gh pr list --repo "$slug" --state open --json number --jq length 2>/dev/null || echo 0)
  fi
fi
instruction_ok=false
if [ -f "$REPO/AGENTS.md" ] && [ -L "$REPO/CLAUDE.md" ] && [ "$(readlink "$REPO/CLAUDE.md")" = "AGENTS.md" ]; then
  instruction_ok=true
fi

worktree_state=$(git -C "$REPO" worktree list --porcelain 2>/dev/null || true)
worktree_count=$(printf '%s\n' "$worktree_state" | awk '/^worktree /{n++} END{print n+0}')
extra_worktrees=$((worktree_count > 0 ? worktree_count - 1 : 0))
locked_worktrees=$(printf '%s\n' "$worktree_state" | awk '/^locked( |$)/{n++} END{print n+0}')
stash_count=$(git -C "$REPO" stash list 2>/dev/null | wc -l | tr -d ' ')
unmerged_branches=$(git -C "$REPO" for-each-ref --format='%(refname:short)' --no-merged "$default" refs/heads 2>/dev/null \
  | awk -v default="$default" '$0 != default {n++} END{print n+0}')

REPO="$REPO" BRANCH="$branch" DEFAULT_BRANCH="$default" DIRTY="$dirty_count" AHEAD="$ahead" BEHIND="$behind" \
OPEN_PRS="$open_prs" INSTRUCTION_OK="$instruction_ok" EXTRA_WORKTREES="$extra_worktrees" \
LOCKED_WORKTREES="$locked_worktrees" STASHES="$stash_count" UNMERGED_BRANCHES="$unmerged_branches" python3 - <<'PY'
import json, os
print(json.dumps({
    "repo": os.environ["REPO"],
    "branch": os.environ["BRANCH"],
    "defaultBranch": os.environ["DEFAULT_BRANCH"],
    "dirtyFiles": int(os.environ["DIRTY"]),
    "ahead": int(os.environ["AHEAD"]),
    "behind": int(os.environ["BEHIND"]),
    "openPullRequests": int(os.environ["OPEN_PRS"]),
    "instructionSync": os.environ["INSTRUCTION_OK"] == "true",
    "extraWorktrees": int(os.environ["EXTRA_WORKTREES"]),
    "lockedWorktrees": int(os.environ["LOCKED_WORKTREES"]),
    "stashes": int(os.environ["STASHES"]),
    "unmergedLocalBranches": int(os.environ["UNMERGED_BRANCHES"]),
    "converged": (
        os.environ["BRANCH"] == os.environ["DEFAULT_BRANCH"]
        and int(os.environ["DIRTY"]) == 0
        and int(os.environ["AHEAD"]) == 0
        and int(os.environ["BEHIND"]) == 0
        and int(os.environ["OPEN_PRS"]) == 0
        and os.environ["INSTRUCTION_OK"] == "true"
        and int(os.environ["EXTRA_WORKTREES"]) == 0
        and int(os.environ["LOCKED_WORKTREES"]) == 0
        and int(os.environ["STASHES"]) == 0
        and int(os.environ["UNMERGED_BRANCHES"]) == 0
    ),
}, sort_keys=True))
PY
