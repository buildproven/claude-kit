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

# Tokenize the raw command without evaluating it.  Bash's `read -a` is not
# quote-aware, so a quoted `-C` path containing spaces would move the `push`
# token out of position and let a protected refspec through.  This parser only
# removes shell quoting and backslash escapes; it never performs expansion or
# executes command substitutions.
COMMAND_TOKENS=()
tokenize_command() {
  local state="unquoted" token="" started=false char escaped index
  for ((index = 0; index < ${#COMMAND}; index += 1)); do
    char="${COMMAND:index:1}"
    case "$state" in
      single)
        if [ "$char" = "'" ]; then
          state="unquoted"
        else
          token+="$char"
        fi
        started=true
        ;;
      double)
        if [ "$char" = '"' ]; then
          state="unquoted"
        elif [ "$char" = "\\" ]; then
          # Hook input is the raw Bash command string. Treat an escaped
          # newline as a line continuation here as in the unquoted state.
          index=$((index + 1))
          [ "$index" -lt "${#COMMAND}" ] || return 1
          escaped="${COMMAND:index:1}"
          if [ "$escaped" = '$' ] || [ "$escaped" = '`' ] ||
            [ "$escaped" = '"' ] || [ "$escaped" = "\\" ]; then
            token+="$escaped"
          elif [ "$escaped" != $'\n' ]; then
            token+="\\$escaped"
          fi
        else
          token+="$char"
        fi
        started=true
        ;;
      unquoted)
        case "$char" in
          '$'|'`') return 1 ;;
          "'") state="single"; started=true ;;
          '"') state="double"; started=true ;;
          "\\")
            index=$((index + 1))
            [ "$index" -lt "${#COMMAND}" ] || return 1
            escaped="${COMMAND:index:1}"
            if [ "$escaped" != $'\n' ]; then
              token+="$escaped"
              started=true
            fi
            ;;
          [[:space:]])
            if [ "$started" = true ]; then
              COMMAND_TOKENS+=("$token")
              token=""
              started=false
            fi
            ;;
          *) token+="$char"; started=true ;;
        esac
        ;;
    esac
  done
  [ "$state" = "unquoted" ] || return 1
  if [ "$started" = true ]; then
    COMMAND_TOKENS+=("$token")
  fi
}

# A malformed shell command cannot be classified safely. Fail closed before
# any partially parsed tokens can reach the branch/refspec checks.
if ! tokenize_command; then
  echo "Blocked: could not parse the push command safely." >&2
  exit 2
fi

GIT_ARGS=(git)
if [ "${COMMAND_TOKENS[0]:-}" = "git" ] &&
  [ "${COMMAND_TOKENS[1]:-}" = "-C" ] && [ -n "${COMMAND_TOKENS[2]:-}" ]; then
  GIT_DIR="${COMMAND_TOKENS[2]}"
  GIT_DIR="${GIT_DIR/#\~/$HOME}"  # expand ~ safely (no eval)
  GIT_ARGS+=( -C "$GIT_DIR" )
fi

# Resolve the first push argument once. Unsupported or incomplete global git
# options fail closed instead of letting each guard re-derive a different
# offset for the subcommand.
push_argument_start() {
  local index=1
  [ "${COMMAND_TOKENS[0]:-}" = "git" ] || return 1
  if [ "${COMMAND_TOKENS[$index]:-}" = "-C" ]; then
    [ -n "${COMMAND_TOKENS[$((index + 1))]:-}" ] || return 1
    index=$((index + 2))
  fi
  [ "${COMMAND_TOKENS[$index]:-}" = "push" ] || return 1
  printf '%s\n' "$((index + 1))"
}

# Check for git push to main or master (with any remote name).  Tokenizing the
# command avoids the platform-dependent extended-regexp edge that previously
# let a `git -C <dir> push origin main` command through in CI.
pushes_protected_branch() {
  local index token target
  index="$(push_argument_start)" || return 1
  for ((; index < ${#COMMAND_TOKENS[@]}; index += 1)); do
    token="${COMMAND_TOKENS[$index]}"
    # A push refspec's destination is after the colon.  Normalize the
    # optional force marker and fully-qualified remote ref so the guard also
    # covers `HEAD:main`, `HEAD:refs/heads/main`, and `origin/main`.
    target="${token##*:}"
    # Git permits an empty destination (`main:`), which means "use the
    # source name". Use that source for protected-branch classification.
    if [[ "$token" == *:* && -z "$target" ]]; then
      target="${token%%:*}"
    fi
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
  # Allow exact force/delete flags (already gated by permissions.ask). Check
  # tokens, not raw substrings: a path such as `/tmp/-final` or an unrelated
  # option containing `-f` must not turn a protected push into an allow.
  protected_push_override() {
    local index token
    index="$(push_argument_start)" || return 1
    for ((; index < ${#COMMAND_TOKENS[@]}; index += 1)); do
      token="${COMMAND_TOKENS[$index]}"
      case "$token" in
        -f|--force|--force-with-lease|--delete) return 0 ;;
      esac
    done
    return 1
  }
  if protected_push_override; then
    exit 0
  fi
  echo "Blocked: direct push to main/master. Create a feature branch and PR instead."
  echo ""
  echo "  git checkout -b feat/my-feature"
  echo "  git push -u origin feat/my-feature"
  echo "  gh pr create"
  exit 2
fi

# Block bare "git push" when on main/master (no explicit branch arg). Use the
# same parsed tokens as protected-ref detection so quoted paths and trailing
# whitespace cannot make this branch diverge from the actual command.
bare_push() {
  local index
  index="$(push_argument_start)" || return 1
  [ "$index" -eq "${#COMMAND_TOKENS[@]}" ]
}
if bare_push; then
  CURRENT_BRANCH=$("${GIT_ARGS[@]}" branch --show-current 2>/dev/null || echo "")
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
