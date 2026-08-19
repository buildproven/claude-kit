#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks direct pushes to main/master
# Exit codes: 0 = allow, 2 = deny with message
#
# --classify-only: skip the allow/deny decision and instead print whether the
# push targets a protected branch (main/master), for callers that need that
# signal without duplicating this file's shell-injection-safe tokenizer.
# Prints "protected" or "unprotected" and always exits 0 (parse failure prints
# "unknown" and exits 0, so a caller can fail closed on the ambiguous case
# without this classification query itself being treated as a denial).

set -euo pipefail

CLASSIFY_ONLY=false
CI_BUDGET_CLASSIFY=false
case "${1:-}" in
  --classify-only) CLASSIFY_ONLY=true ;;
  --ci-budget-classify) CI_BUDGET_CLASSIFY=true ;;
esac

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
          ';'|'('|')')
            if [ "$started" = true ]; then
              COMMAND_TOKENS+=("$token")
              token=""
              started=false
            fi
            COMMAND_TOKENS+=("$char")
            ;;
          '&'|'|')
            if [ "$started" = true ]; then
              COMMAND_TOKENS+=("$token")
              token=""
              started=false
            fi
            if [ "${COMMAND:index+1:1}" = "$char" ]; then
              COMMAND_TOKENS+=("$char$char")
              index=$((index + 1))
            else
              COMMAND_TOKENS+=("$char")
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
  if [ "$CLASSIFY_ONLY" = true ] || [ "$CI_BUDGET_CLASSIFY" = true ]; then
    echo "unknown"
    exit 0
  fi
  echo "Blocked: could not parse the push command safely." >&2
  exit 2
fi

# Resolve the first push argument once. Git accepts several global options before
# the subcommand; recognizing them here keeps the guard aligned with real git
# invocations instead of silently treating those commands as non-pushes.
is_command_separator() {
  case "$1" in
    ';'|'&'|'&&'|'|'|'||'|'('|')') return 0 ;;
    *) return 1 ;;
  esac
}

push_argument_start() {
  local index=0 scan token segment_end
  while [ "$index" -lt "${#COMMAND_TOKENS[@]}" ]; do
    if [ "${COMMAND_TOKENS[$index]}" != "git" ] ||
      { [ "$index" -gt 0 ] && ! is_command_separator "${COMMAND_TOKENS[$((index - 1))]}"; }; then
      index=$((index + 1))
      continue
    fi

    segment_end=$((index + 1))
    while [ "$segment_end" -lt "${#COMMAND_TOKENS[@]}" ] &&
      ! is_command_separator "${COMMAND_TOKENS[$segment_end]}"; do
      segment_end=$((segment_end + 1))
    done
    scan=$((index + 1))
    while [ "$scan" -lt "$segment_end" ]; do
      token="${COMMAND_TOKENS[$scan]}"
      if [ "$token" = "push" ]; then
        GIT_COMMAND_INDEX="$index"
        PUSH_COMMAND_INDEX="$scan"
        PUSH_ARGUMENT_START=$((scan + 1))
        PUSH_ARGUMENT_END="$segment_end"
        return 0
      fi
      case "$token" in
      # Global options that take a separate value.
      -C|-c|--config-env|--exec-path|--git-dir|--work-tree|--namespace|--super-prefix)
        [ "$((scan + 1))" -lt "$segment_end" ] || return 2
        scan=$((scan + 2))
        ;;
      # The same value-bearing options in --name=value form.
      --config-env=*|--exec-path=*|--git-dir=*|--work-tree=*|--namespace=*|--super-prefix=*)
        scan=$((scan + 1))
        ;;
      # Boolean global options.
      -p|-P|--no-pager|--paginate|--no-replace-objects|--no-lazy-fetch|--no-optional-locks|--no-advice|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs)
        scan=$((scan + 1))
        ;;
      *)
        # A non-option is another git subcommand, so this is safely not a push.
        # An unknown option cannot be classified without risking a bypass.
        [[ "$token" == -* ]] && return 2
        break
        ;;
      esac
    done
    index=$((segment_end + 1))
  done
  return 1
}

PUSH_ARGUMENT_START=""
PUSH_ARGUMENT_END=""
PUSH_COMMAND_INDEX=""
GIT_COMMAND_INDEX=""
if push_argument_start; then
  # Preserve every parsed global option when checking the current branch for a
  # bare push (for example, `git --git-dir=/repo/.git push`).
  GIT_ARGS=("${COMMAND_TOKENS[@]:$GIT_COMMAND_INDEX:$((PUSH_COMMAND_INDEX - GIT_COMMAND_INDEX))}")
else
  PUSH_PARSE_STATUS=$?
  if [ "$PUSH_PARSE_STATUS" -eq 2 ]; then
    if [ "$CLASSIFY_ONLY" = true ] || [ "$CI_BUDGET_CLASSIFY" = true ]; then
      echo "unknown"
      exit 0
    fi
    echo "Blocked: could not classify the git command safely." >&2
    exit 2
  fi
  GIT_ARGS=(git)
fi

# Check for git push to main or master (with any remote name).  Tokenizing the
# command avoids the platform-dependent extended-regexp edge that previously
# let a `git -C <dir> push origin main` command through in CI.
pushes_protected_branch() {
  local index token target
  [ -n "$PUSH_ARGUMENT_START" ] || return 1
  index="$PUSH_ARGUMENT_START"
  for ((; index < PUSH_ARGUMENT_END; index += 1)); do
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

# Block bare "git push" when on main/master (no explicit branch arg). Use the
# same parsed tokens as protected-ref detection so quoted paths and trailing
# whitespace cannot make this branch diverge from the actual command.
bare_push() {
  local index
  [ -n "$PUSH_ARGUMENT_START" ] || return 1
  index="$PUSH_ARGUMENT_START"
  [ "$index" -eq "$PUSH_ARGUMENT_END" ]
}

# Prove the only topic-branch case that cannot trigger Actions: this command
# pushes the current branch and GitHub reports no open PR for it. Any different
# refspec, parser ambiguity, missing CLI, or API failure stays "unknown" so the
# caller runs budget admission. This preserves the first-push path needed to
# open a PR without exempting later pull_request:synchronize pushes.
current_topic_push() {
  local index token remote_seen=false source destination
  local -a refspecs=()
  CURRENT_BRANCH=$("${GIT_ARGS[@]}" branch --show-current 2>/dev/null || true)
  [ -n "$CURRENT_BRANCH" ] || return 1
  [ "$CURRENT_BRANCH" != main ] && [ "$CURRENT_BRANCH" != master ] || return 1

  index="$PUSH_ARGUMENT_START"
  for ((; index < PUSH_ARGUMENT_END; index += 1)); do
    token="${COMMAND_TOKENS[$index]}"
    case "$token" in
      -u|--set-upstream|--force|--force-with-lease|--atomic|--dry-run|--porcelain|--no-verify|--quiet|--verbose)
        ;;
      -o|--push-option|--receive-pack|--exec)
        index=$((index + 1))
        [ "$index" -lt "$PUSH_ARGUMENT_END" ] || return 1
        ;;
      --push-option=*|--receive-pack=*|--exec=*|--force-with-lease=*|--signed|--signed=*|--no-signed)
        ;;
      --all|--mirror|--tags|--delete|--prune|--follow-tags) return 1 ;;
      --) ;;
      -*) return 1 ;;
      *)
        if [ "$remote_seen" = false ]; then
          remote_seen=true
          PUSH_REMOTE="$token"
        else
          refspecs+=("$token")
        fi
        ;;
    esac
  done

  # Only an explicit refspec proves the destination. Bare and remote-only
  # pushes depend on push.default, upstream, and remote push configuration;
  # treat them like multi-ref and cross-branch pushes: unknown and admitted.
  [ "${#refspecs[@]}" -le 1 ] || return 1
  [ "${#refspecs[@]}" -eq 1 ] || return 1
  token="${refspecs[0]}"
  while [[ "$token" == +* ]]; do token="${token:1}"; done
  if [[ "$token" == *:* ]]; then
    source="${token%%:*}"
    destination="${token##*:}"
  else
    source="$token"
    destination="$token"
  fi
  source="${source#refs/heads/}"
  destination="${destination#refs/heads/}"
  [ "$source" = HEAD ] || [ "$source" = "$CURRENT_BRANCH" ] || return 1
  [ "$destination" = "$CURRENT_BRANCH" ]
}

github_repository_for_push_remote() {
  local remote_url host repository
  remote_url=$("${GIT_ARGS[@]}" remote get-url --push "$PUSH_REMOTE" 2>/dev/null) || return 1
  case "$remote_url" in
    https://*/*/*)
      host="${remote_url#https://}"
      host="${host%%/*}"
      repository="${remote_url#https://*/}"
      ;;
    ssh://git@*/*/*)
      host="${remote_url#ssh://git@}"
      host="${host%%/*}"
      repository="${remote_url#ssh://git@*/}"
      ;;
    git@*:*/*)
      host="${remote_url#git@}"
      host="${host%%:*}"
      repository="${remote_url#*:}"
      ;;
    *) return 1 ;;
  esac
  repository="${repository%.git}"
  [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 1
  PUSH_REPOSITORY="$host/$repository"
}

if [ "$CI_BUDGET_CLASSIFY" = true ]; then
  if pushes_protected_branch; then
    echo "ci-trigger"
    exit 0
  fi
  if ! current_topic_push; then
    echo "unknown"
    exit 0
  fi
  if ! github_repository_for_push_remote; then
    echo "unknown"
    exit 0
  fi
  command -v gh >/dev/null 2>&1 || { echo "unknown"; exit 0; }
  REPOSITORY_ROOT=$("${GIT_ARGS[@]}" rev-parse --show-toplevel 2>/dev/null) || {
    echo "unknown"
    exit 0
  }
  OPEN_PRS=$(cd "$REPOSITORY_ROOT" && gh pr list --repo "$PUSH_REPOSITORY" \
    --head "$CURRENT_BRANCH" \
    --state open --limit 1 --json number 2>/dev/null) || {
    echo "unknown"
    exit 0
  }
  if ! printf '%s' "$OPEN_PRS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "unknown"
  elif printf '%s' "$OPEN_PRS" | jq -e 'length > 0' >/dev/null 2>&1; then
    echo "ci-trigger"
  else
    echo "no-ci"
  fi
  exit 0
fi

if [ "$CLASSIFY_ONLY" = true ]; then
  # Same protected-branch determination as the allow/deny path below, minus
  # the force/delete override carve-out: a caller asking "will this push
  # reach main/master" (e.g. deciding whether to run a CI-minute budget
  # check) wants the target branch, not whether an unrelated flag would have
  # let a direct push through. This query path must never fall into the
  # real allow/deny logic below — printing a classification is its only
  # side effect.
  if pushes_protected_branch; then
    echo "protected"
    exit 0
  fi
  if bare_push; then
    CURRENT_BRANCH=$("${GIT_ARGS[@]}" branch --show-current 2>/dev/null || echo "")
    if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
      echo "protected"
      exit 0
    fi
  fi
  echo "unprotected"
  exit 0
fi

if pushes_protected_branch; then
  # Allow exact force/delete flags (already gated by permissions.ask). Check
  # tokens, not raw substrings: a path such as `/tmp/-final` or an unrelated
  # option containing `-f` must not turn a protected push into an allow.
  protected_push_override() {
    local index token
    [ -n "$PUSH_ARGUMENT_START" ] || return 1
    index="$PUSH_ARGUMENT_START"
    for ((; index < PUSH_ARGUMENT_END; index += 1)); do
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
