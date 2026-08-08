#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks direct pushes to main/master
# Exit codes: 0 = allow, 2 = deny with message

set -euo pipefail

# Read hook JSON from stdin
INPUT=$(cat)

# Extract command from tool_input (prefer jq, fallback to grep)
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Extract -C <dir> from command if present (handles cross-repo pushes)
# `|| true` is required: under `set -euo pipefail` a no-match `grep` exits 1 and
# kills the hook before it can deny anything. Commands without `-C` are the
# common case, so omitting it silently disabled this guard entirely.
GIT_DIR=$(echo "$COMMAND" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]]+' | head -1 | awk '{print $3}' || true)
if [ -n "$GIT_DIR" ]; then
  GIT_DIR="${GIT_DIR/#\~/$HOME}"  # expand ~ safely (no eval)
  GIT_CMD="git -C $GIT_DIR"
else
  GIT_CMD="git"
fi

# Check for git push to main or master (with any remote name).  Tokenizing the
# command avoids the platform-dependent extended-regexp edge that previously
# let a `git -C <dir> push origin main` command through in CI.
pushes_protected_branch() {
  local -a tokens
  local index token target
  read -r -a tokens <<< "$COMMAND"
  [ "${tokens[0]:-}" = "git" ] || return 1
  index=1
  if [ "${tokens[$index]:-}" = "-C" ]; then
    index=$((index + 2))
  fi
  [ "${tokens[$index]:-}" = "push" ] || return 1
  index=$((index + 1))
  for ((; index < ${#tokens[@]}; index += 1)); do
    token="${tokens[$index]}"
    # A push refspec's destination is after the colon.  Normalize the
    # optional force marker and fully-qualified remote ref so the guard also
    # covers `HEAD:main`, `HEAD:refs/heads/main`, and `origin/main`.
    target="${token##*:}"
    while [[ "$target" == +* ]]; do
      target="${target:1}"
    done
    case "$target" in
      main|master|*/main|*/master) return 0 ;;
    esac
  done
  return 1
}

if pushes_protected_branch; then
  # Allow force push (already gated by permissions.ask) and push --delete
  if echo "$COMMAND" | grep -qE '\-\-force|\-f|\-\-delete'; then
    exit 0
  fi
  echo "Blocked: direct push to main/master. Create a feature branch and PR instead."
  echo ""
  echo "  git checkout -b feat/my-feature"
  echo "  git push -u origin feat/my-feature"
  echo "  gh pr create"
  exit 2
fi

# Block bare "git push" when on main/master (no explicit branch arg)
if echo "$COMMAND" | grep -qE 'git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push[[:space:]]*$'; then
  CURRENT_BRANCH=$($GIT_CMD branch --show-current 2>/dev/null || echo "")
  if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    echo "Blocked: bare 'git push' while on $CURRENT_BRANCH. Create a feature branch and PR instead."
    echo ""
    echo "  git checkout -b feat/my-feature"
    echo "  git push -u origin feat/my-feature"
    echo "  gh pr create"
    exit 2
  fi
fi

exit 0
