#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks destructive filesystem commands that target
# high-value paths (~/Projects, ~/.claude, $HOME, /) or contain unresolved shell
# variables in the target. Exit codes: 0 = allow, 2 = deny with message.
#
# Motivation: on 2026-04-19 a test `trap` ran `rm -rf "$(dirname "$VAR")"`
# where the variable pointed to a git worktree inside ~/Projects/internal/,
# wiping the entire internal/ directory. The host user restored from Time
# Machine. This hook exists so that class of accident cannot repeat.

set -euo pipefail

INPUT=$(cat)

if command -v jq &>/dev/null; then
  COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
else
  COMMAND=$(printf '%s' "$INPUT" \
    | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"//; s/"$//')
fi

[ -z "$COMMAND" ] && exit 0

deny() {
  echo "Blocked: destructive command flagged by block-destructive-paths.sh." >&2
  echo "Reason: $1" >&2
  echo "" >&2
  echo "Command (first 400 chars):" >&2
  printf '  %s\n' "${COMMAND:0:400}" >&2
  echo "" >&2
  echo "If this is intentional, narrow the target (absolute path inside a mktemp dir or a" >&2
  echo "single repo-owned build artifact) or run the command yourself and confirm with the" >&2
  echo "user. Never 'rm -rf' a directory resolved through shell expansion (\$var, \$(...), backticks)." >&2
  exit 2
}

CMD_FLAT=$(printf '%s' "$COMMAND" | tr '\n' ' ' | tr -s ' ')

has_recursive_force_rm() {
  local candidate="$1"
  local has_recursive=false
  local has_force=false

  if printf '%s' "$candidate" | grep -qE '(^|[[:space:]])(--recursive|-[a-zA-Z]*r[a-zA-Z]*)([[:space:]]|$)'; then
    has_recursive=true
  fi
  if printf '%s' "$candidate" | grep -qE '(^|[[:space:]])(--force|-[a-zA-Z]*f[a-zA-Z]*)([[:space:]]|$)'; then
    has_force=true
  fi

  [[ "$has_recursive" == "true" && "$has_force" == "true" ]]
}

# ---------------------------------------------------------------------------
# Rule 1: `rm -rf` / `rm -fr` / `rm -r -f` with unsafe target.
# ---------------------------------------------------------------------------
RM_COMMANDS=$(printf '%s' "$CMD_FLAT" | grep -oE '(^|[;&|][[:space:]]*)rm[[:space:]]+[^;&|]*' | head -5 || true)
while IFS= read -r TARGETS; do
  [[ -z "$TARGETS" ]] && continue
  has_recursive_force_rm "$TARGETS" || continue

  # 1a. Variable/command substitution in target — cannot prove safety.
  if echo "$TARGETS" | grep -qE '\$|`'; then
    deny "rm -rf target contains a shell variable or command substitution. Substitutions can resolve to a parent directory (e.g. \$(dirname \$X) → /Users/you/Projects/internal)."
  fi

  # 1b. Literal top-level personal directories that must never be wiped.
  # Matches EXACTLY these paths (with optional trailing slash), not descendants.
  # Descendants like ~/Projects/my-repo are allowed through if the command
  # otherwise passes (rule 1a already blocks dynamic substitutions).
  #
  # Blocked literal paths:
  #   /
  #   ~, ~/
  #   $HOME, $HOME/
  #   /Users, /Users/
  #   /Users/<user>, /Users/<user>/
  #   /Users/<user>/Projects, /Users/<user>/Projects/
  #   /Users/<user>/Projects/internal, /Users/<user>/Projects/internal/
  #   /Users/<user>/Projects/products, /Users/<user>/Projects/products/
  #   /Users/<user>/Projects/personal, /Users/<user>/Projects/personal/
  #   /Users/<user>/Projects/_archived, /Users/<user>/Projects/_archived/
  #   /Users/<user>/.claude, /Users/<user>/.claude/
  #   /Users/<user>/.ssh, /Users/<user>/.aws, /Users/<user>/.config
  BOUNDARY='([[:space:]]|$|"|'"'"')'
  # SC2016 disabled intentionally: this is a grep -E regex, not a template.
  # The literal `\$HOME` MUST reach grep un-expanded so it matches the string
  # "$HOME" in a user's command. Expanding it (double quotes) would resolve to
  # /Users/<me> and silently stop catching `rm -rf $HOME` — a security regression.
  # shellcheck disable=SC2016
  BLOCKED_LITERALS='(/|~/?|\$HOME/?|/Users/?|/Users/[^/[:space:]"'"'"']+/?|/Users/[^/[:space:]"'"'"']+/Projects/?|/Users/[^/[:space:]"'"'"']+/Projects/(internal|products|personal|_archived)/?|/Users/[^/[:space:]"'"'"']+/\.(claude|ssh|aws|config)/?)'
  if echo "$TARGETS" | grep -qE "(^|[[:space:]]|\"|'\''')${BLOCKED_LITERALS}${BOUNDARY}"; then
    deny "rm -rf target is a top-level personal directory. Wiping \$HOME, /Users, ~/Projects, ~/Projects/internal, ~/.claude, ~/.ssh, ~/.aws, or ~/.config is refused. Concrete per-project paths under these are allowed."
  fi

  # 1c. Bare `*`, `.`, `..` — wipes current dir.
  if echo "$TARGETS" | grep -qE '(^|[[:space:]])(\*|\.|\.\.)[[:space:]]*$'; then
    deny "rm -rf with bare *, . or .. — refuses to act on the whole current directory."
  fi
done <<< "$RM_COMMANDS"

# ---------------------------------------------------------------------------
# Rule 2: `find … -delete` or `find … -exec rm` with dynamic/top-level root.
# ---------------------------------------------------------------------------
if echo "$CMD_FLAT" | grep -qE 'find[[:space:]].*(-delete|-exec[[:space:]]+rm)'; then
  FIND_ROOT=$(echo "$CMD_FLAT" | sed -E 's/.*find[[:space:]]+([^[:space:]]+).*/\1/' | tr -d '"'"'"'')
  if printf '%s' "$FIND_ROOT" | grep -qE '^\$|`|\$\('; then
    deny "find ... -delete uses a dynamic root path."
  fi
  if printf '%s' "$FIND_ROOT" | grep -qE '^(/|~/?|\$HOME/?|\$\{HOME\}/?|/Users/?|/Users/[^/]+/?|/Users/[^/]+/(Projects|\.claude|\.ssh|\.aws|\.config)/?|/Users/[^/]+/Projects/(internal|products|personal|_archived)/?|/home/?|/home/[^/]+/?|/home/[^/]+/(Projects|\.claude|\.ssh|\.aws|\.config)/?)$'; then
    deny "find ... -delete rooted at a top-level personal directory."
  fi
fi

# ---------------------------------------------------------------------------
# Rule 3: `git clean -fd*` after `cd $VAR` — resolved target unknown.
# ---------------------------------------------------------------------------
if echo "$CMD_FLAT" | grep -qE 'git[[:space:]]+clean[[:space:]]+-[a-z]*f[a-z]*d'; then
  if echo "$CMD_FLAT" | grep -qE 'cd[[:space:]]+\$|cd[[:space:]]+`'; then
    deny "git clean -fd after a dynamic 'cd \$VAR' — resolved target unknown."
  fi
fi

# ---------------------------------------------------------------------------
# Rule 4: Redirects that TRUNCATE personal config files or the Projects tree.
# Only truncating redirects are destructive; '>>' (append) cannot wipe a file,
# so appends are allowed.
#
# We match against a QUOTE-STRIPPED copy of the command. Bash concatenates
# adjacent quoted and unquoted word segments before opening a redirect target,
# so `> "$HOME"/.env`, `> /Users/u/".env"`, and `> ~/"Projects"/foo` all open
# the same paths as their unquoted forms. Deleting quote characters first
# collapses every split-quote variant into one contiguous string the regex can
# see. (This is a best-effort textual guard, not a shell parser — it will not
# catch a target hidden behind a variable like `> $DEST`; Rule 1's substitution
# guard covers the destructive-rm case, and truncation via an opaque variable
# is out of scope for this textual hook.)
#
# Regex breakdown:
#   (^|[^>&])      — start of a redirect word, not the middle of '>>'/'>&…'.
#   [0-9]*&?>&?\|? — the truncating operator family: '>', '>|', '>&', '>&|',
#                    'N>', 'N>&', '&>' (stdout+stderr). '>>' (append) is
#                    excluded because its second '>' is not part of this class.
#   personal path  — one of three home syntaxes (/Users/<u>, '~', '$HOME'/
#                    '${HOME}') followed by a config dotfile (a leading '.'
#                    then any non-slash/non-space run, so '.bash_profile',
#                    '.env.local', '.p10k.zsh' are all covered) or the exact
#                    'Projects' segment. A trailing boundary ($|space|/) after
#                    'Projects' prevents over-blocking siblings like
#                    'Projects2' or 'Projects-old'. Non-personal home paths
#                    (e.g. '> ~/notes') stay allowed. Quotes are already
#                    stripped, so the dotfile run needs no quote exclusions.
#
# Normalization before matching (CMD_MATCH), applied in order:
#   1. tr -d '"'\''  — delete quote characters, so split-quote concatenation
#      ('> "$HOME"/.env', '> /Users/u/".env"') and ANSI-C/locale quoting
#      ('$'\''…'\''', '$"…"') collapse toward a bare path.
#   2. tr -d '\\'   — delete backslashes, so per-character escapes in an
#      unquoted target ('> /Users/u/\.env', '\Projects/foo') resolve to the
#      literal path the shell would open.
#   3. sed 's/\$([~/.])/\1/'  — drop a '$' that (after quote deletion) sits
#      immediately before a path-starting char, i.e. the leftover '$' from a
#      '$'\''/Users/…'\''' ANSI-C literal. Restricted to [~/.] so it does NOT
#      touch '$HOME'/'${HOME}' (H and { are excluded), which must keep matching.
#   4. sed 's#/+#/#'  — collapse runs of slashes to one, because the shell
#      treats '//' as '/'. Closes the whole repeated-slash class at any
#      position ('~//.env', '/Users//u/.env', '/Users/u//Projects/foo').
#
# This is a best-effort textual normalizer, NOT a shell parser. A target whose
# value is not literally present — behind a variable ('> $DEST'), command
# substitution, or printf-constructed — is out of scope here; the destructive
# 'rm' incident vector is covered separately by Rule 1's substitution guard.
# ---------------------------------------------------------------------------
# SC1003: '\\' is the intended single-backslash argument to `tr -d`, not a
#         mis-escaped quote — deleting backslashes is exactly the goal.
# SC2016: the '$' in the sed script must stay literal (single quotes) so sed
#         sees it; expanding it in the shell would defeat the substitution.
# shellcheck disable=SC1003,SC2016
CMD_MATCH=$(printf '%s' "$CMD_FLAT" \
  | tr -d '"'"'" \
  | tr -d '\\' \
  | sed -E 's/\$([~/.])/\1/g' \
  | sed -E 's#/+#/#g')
TRUNC_OP='(^|[^>&])[0-9]*&?>&?\|?'
PERSONAL_REDIRECT='(/Users/[^/]+|~|\$\{?HOME\}?)/(\.[^/[:space:]]+|Projects($|[[:space:]/]))'
if echo "$CMD_MATCH" | grep -qE "${TRUNC_OP}[[:space:]]*${PERSONAL_REDIRECT}"; then
  deny "Output redirect that TRUNCATES a personal config or project path (> ~/.foo, >| ~/.foo, > \$HOME/.foo, >& ~/.foo, or > ~/Projects/...). Use '>>' to append instead."
fi

# ---------------------------------------------------------------------------
# Rule 5: `trap … rm -rf` — traps are the highest-risk vector.
# They run at EXIT after the variable has already been resolved, and a
# wrong assumption about $var silently destroys the parent dir at cleanup.
# ---------------------------------------------------------------------------
if echo "$CMD_FLAT" | grep -qE 'trap[[:space:]]+.*rm[[:space:]]+' && has_recursive_force_rm "$CMD_FLAT"; then
  deny "trap with embedded 'rm -rf' — extremely easy to resolve the wrong path at EXIT. Use an explicit cleanup function with literal paths."
fi

exit 0
