#!/usr/bin/env bash
# PreToolUse hook — blocks commits from primary checkouts and main/master.
set -euo pipefail

LOG_DIR="$HOME/.claude/logs"
LOG_FILE="$LOG_DIR/branch-guard-blocks.log"

log_event() {
  mkdir -p "$LOG_DIR" 2>/dev/null || return 0
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$(date -u +%FT%TZ)" "$1" "${2:-?}" "${3:-?}" "${4:-?}" >>"$LOG_FILE"
}

resolve_dir() {
  (
    cd "$1" >/dev/null 2>&1
    pwd -P
  )
}

INPUT="$(cat)"
if command -v jq >/dev/null 2>&1; then
  COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  COMMAND="$(printf '%s' "$INPUT" |
    grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' |
    head -1 |
    sed 's/.*"command"[[:space:]]*:[[:space:]]*"//; s/"$//')"
fi
[ -n "$COMMAND" ] || exit 0
printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])git([[:space:]]|$)' || exit 0
printf '%s' "$COMMAND" | grep -qE '(^|[;&|[:space:]])commit([;&|[:space:]]|$)' || exit 0

GIT_DIR=""
BYPASS_REQUESTED=0
if command -v python3 >/dev/null 2>&1; then
  PARSED_COMMIT="$(python3 - "$COMMAND" <<'PY'
import shlex
import sys

lexer = shlex.shlex(sys.argv[1], posix=True, punctuation_chars=";&|")
lexer.whitespace_split = True
tokens = list(lexer)
segments = []
segment = []
for token in tokens:
    if token and all(character in ";&|" for character in token):
        if segment:
            segments.append(segment)
            segment = []
    else:
        segment.append(token)
if segment:
    segments.append(segment)

current_dir = ""
targets = []
for words in segments:
    if len(words) >= 2 and words[0] == "cd":
        current_dir = words[1]
        continue
    for index, word in enumerate(words):
        if word != "git":
            continue
        git_dir = ""
        cursor = index + 1
        is_commit = False
        while cursor < len(words):
            argument = words[cursor]
            if argument == "-C" and cursor + 1 < len(words):
                git_dir = words[cursor + 1]
                cursor += 2
                continue
            if argument.startswith("-C") and len(argument) > 2:
                git_dir = argument[2:]
            if argument == "commit":
                is_commit = True
                break
            cursor += 1
        if is_commit:
            bypass = "BYPASS_BRANCH_GUARD=1" in words[:index]
            targets.append((git_dir or current_dir or ".", bypass))
if targets:
    target, bypass = targets[-1]
    print(f"{target}\t{1 if bypass else 0}")
PY
)"
  GIT_DIR="${PARSED_COMMIT%	*}"
  BYPASS_REQUESTED="${PARSED_COMMIT##*	}"
else
  GIT_DIR="$(printf '%s' "$COMMAND" |
    grep -oE 'git\s+-C\s+\S+' |
    tail -1 |
    awk '{print $3}' || true)"
  if [ -z "$GIT_DIR" ]; then
    GIT_DIR="$(printf '%s' "$COMMAND" |
    grep -oE '^[[:space:]]*cd[[:space:]]+\S+' |
    head -1 |
    awk '{print $2}' || true)"
  fi
  [ -n "$GIT_DIR" ] || GIT_DIR="."
  if printf '%s' "$COMMAND" |
    grep -qE '(^|[;&|][[:space:]]*)(env[[:space:]]+)?BYPASS_BRANCH_GUARD=1[[:space:]]+git([[:space:]]|$)'; then
    BYPASS_REQUESTED=1
  fi
fi
[ -n "$GIT_DIR" ] || exit 0
if [ -n "$GIT_DIR" ]; then
  GIT_DIR="${GIT_DIR/#\~/$HOME}"
  REPO_ROOT="$(git -C "$GIT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  CURRENT_BRANCH="$(git -C "$GIT_DIR" branch --show-current 2>/dev/null || true)"
else
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
fi

if [ "$BYPASS_REQUESTED" = "1" ]; then
  log_event "bypass" "$REPO_ROOT" "$CURRENT_BRANCH" \
    "explicit BYPASS_BRANCH_GUARD=1"
  exit 0
fi

# A first commit is required before Git can create a linked worktree.
if [ -n "$REPO_ROOT" ] &&
  ! git -C "$REPO_ROOT" rev-parse HEAD >/dev/null 2>&1; then
  log_event "allow" "$REPO_ROOT" "$CURRENT_BRANCH" "fresh repo (no HEAD)"
  exit 0
fi

print_fix_hint() {
  local repo_root="$1"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  echo ""
  echo "  Fix:"
  echo "    node \"$script_dir/worktree-manager.js\" create \\"
  echo "      --repo \"$repo_root\" --branch feature/my-change"
  echo "    # then commit from the returned worktreePath"
  echo ""
  echo "  Or for an exceptional one-off (audit-logged):"
  echo "    BYPASS_BRANCH_GUARD=1 git commit -m \"...\""
}

if [ -n "$REPO_ROOT" ]; then
  CURRENT_GIT_DIR="$(resolve_dir "$(git -C "$REPO_ROOT" rev-parse --git-dir)")"
  COMMON_GIT_DIR="$(resolve_dir "$(git -C "$REPO_ROOT" rev-parse --git-common-dir)")"
  if [ "$CURRENT_GIT_DIR" = "$COMMON_GIT_DIR" ]; then
    echo "Blocked: git commit from primary checkout of $REPO_ROOT (branch: $CURRENT_BRANCH)"
    print_fix_hint "$REPO_ROOT"
    log_event "block" "$REPO_ROOT" "$CURRENT_BRANCH" "primary checkout"
    exit 2
  fi
fi

if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
  echo "Blocked: git commit on $CURRENT_BRANCH. Create a feature worktree first."
  print_fix_hint "${REPO_ROOT:-.}"
  log_event "block" "$REPO_ROOT" "$CURRENT_BRANCH" "on $CURRENT_BRANCH"
  exit 2
fi

exit 0
