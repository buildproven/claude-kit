#!/usr/bin/env bash
# PreToolUse hook for Bash — blocks destructive filesystem commands that target
# high-value paths (~/Projects, ~/.claude, $HOME, /) or contain unresolved shell
# variables in the target. Exit codes: 0 = allow, 2 = deny with message.
#
# Motivation: on 2026-04-19 a test `trap` ran `rm -rf "$(dirname "$VAR")"`
# where the variable pointed to a git worktree inside ~/Projects/internal/,
# wiping the entire internal/ directory. The host user restored from Time
# Machine. This hook exists so that class of accident cannot repeat.
#
# KNOWN LIMIT: this is a textual guard, not a shell interpreter. A destructive
# target that is not literally present in the command string cannot be seen —
# notably `xargs rm -rf < targets.txt`, where the paths live in a file, and
# `rm -rf $DEST` where the value is opaque (Rule 1a blocks the substitution
# form outright for exactly this reason). Such commands are allowed through.

set -euo pipefail

INPUT=$(cat)

# Node is the kit's required runtime. A regex cannot safely decode JSON strings:
# escaped quotes truncated the exact `rm -rf "$(dirname "$VAR")"` incident form.
if ! command -v node &>/dev/null; then
  echo "Blocked: cannot inspect Bash command because the required Node runtime is unavailable." >&2
  exit 2
fi
if ! COMMAND=$(printf '%s' "$INPUT" | node -e '
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    try {
      const command = JSON.parse(raw)?.tool_input?.command;
      if (command !== undefined && typeof command !== "string") process.exit(1);
      process.stdout.write(command || "");
    } catch { process.exit(1); }
  });
'); then
  echo "Blocked: cannot inspect Bash command because the hook payload is invalid JSON." >&2
  exit 2
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

  if printf '%s' "$candidate" | grep -qE '(^|[[:space:]])(--recursive|-[a-zA-Z]*[rR][a-zA-Z]*)([[:space:]]|$)'; then
    has_recursive=true
  fi
  if printf '%s' "$candidate" | grep -qE '(^|[[:space:]])(--force|-[a-zA-Z]*f[a-zA-Z]*)([[:space:]]|$)'; then
    has_force=true
  fi

  [[ "$has_recursive" == "true" && "$has_force" == "true" ]]
}

# Collapse `.` and `..` segments so a detour through a child cannot disguise a
# protected root: `~/Projects/../Projects` and `~/Projects/./` both resolve to
# `~/Projects`. Purely textual — it does not touch the filesystem or resolve
# symlinks — which is the right scope for a guard that must also reason about
# paths that do not exist yet. Repeated until stable so nested `../../` chains
# fully collapse.
collapse_path_segments() {
  local text="$1" previous=""
  while [[ "$text" != "$previous" ]]; do
    previous="$text"
    # Remove `<segment>/../` where <segment> is not itself `..`.
    text=$(printf '%s' "$text" | sed -E 's#(^|/)([^/[:space:]]|[^/[:space:]][^/[:space:]]|[^./[:space:]][^/[:space:]]*|[^/[:space:]]*[^./[:space:]])/\.\./#\1#g')
    # Remove `./` segments and a trailing `/.`.
    text=$(printf '%s' "$text" | sed -E 's#(^|/)\./#\1#g; s#/\.$##g')
  done
  printf '%s' "$text"
}

# The set of literal top-level personal directories that must never be wiped,
# in every spelling (`~`, `$HOME`, `${HOME}`, `/Users/<u>`, `/home/<u>`).
# Rules 1 and 2 share this so a root protected against `rm -rf` cannot be left
# unprotected against `find -delete`, which is exactly how the two drifted.
BLOCKED_LITERALS='(/\*?|~/?\*?|~/Projects/?\*?|~/Projects/(internal|products|personal|_archived)/?\*?|~/\.(claude|ssh|aws|config)/?\*?|\$\{?HOME\}?/?\*?|\$\{?HOME\}?/Projects/?\*?|\$\{?HOME\}?/Projects/(internal|products|personal|_archived)/?\*?|\$\{?HOME\}?/\.(claude|ssh|aws|config)/?\*?|/(Users|home)/?\*?|/(Users|home)/[^/[:space:]]+/?\*?|/(Users|home)/[^/[:space:]]+/Projects/?\*?|/(Users|home)/[^/[:space:]]+/Projects/(internal|products|personal|_archived)/?\*?|/(Users|home)/[^/[:space:]]+/\.(claude|ssh|aws|config)/?\*?)'

# ---------------------------------------------------------------------------
# Rule 1: `rm -rf` / `rm -fr` / `rm -r -f` with unsafe target.
# ---------------------------------------------------------------------------
# Command boundaries include shell *control constructs*, not just `;`, `&`, `|`.
# Anchoring only on those three let `(rm -rf ~)`, `if true; then rm -rf ~; fi`,
# `for i in 1; do rm -rf ~; done`, `{ rm -rf ~; }` and a plain newline-separated
# `rm` escape Rule 1 entirely — a fail-open bypass of the whole guard. Treat
# `(`, `)`, `{`, `}` and newlines as boundaries on both sides so a removal
# nested in any of them is still extracted and inspected.
#
# The optional leading `\\?` matches `\rm`, the standard way to bypass a shell
# alias. It reaches the very same binary as `rm`, so a guard that inspects
# `/bin/rm` but not `\rm` is trivially evaded by one character.
RM_COMMANDS=$(printf '%s' "$CMD_FLAT" | grep -oE '(^|[;&|(){}[:space:]][[:space:]]*)((sudo|command|env)[[:space:]]+)*\\?([^[:space:];|(){}]*/)?rm[[:space:]]+[^;&|(){}]*' | head -5 || true)
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
  #   Linux equivalents rooted at /home/<user>
  # A trailing /* is also blocked: deleting every child is equivalent to
  # deleting the protected directory for data-loss purposes.
  BOUNDARY='([[:space:]]|$|"|'"'"')'
  # SC2016 disabled intentionally: this is a grep -E regex, not a template.
  # The literal `\$HOME` MUST reach grep un-expanded so it matches the string
  # "$HOME" in a user's command. Expanding it (double quotes) would resolve to
  # /Users/<me> and silently stop catching `rm -rf $HOME` — a security regression.
  # shellcheck disable=SC2016
  TARGETS_MATCH=$(printf '%s' "$TARGETS" | tr -d '"'"'"'' | sed -E 's#/+#/#g')
  TARGETS_MATCH=$(collapse_path_segments "$TARGETS_MATCH")
  if echo "$TARGETS_MATCH" | grep -qE "(^|[[:space:]])${BLOCKED_LITERALS}${BOUNDARY}"; then
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
  FIND_ROOT=$(collapse_path_segments "$(printf '%s' "$FIND_ROOT" | sed -E 's#/+#/#g')")

  # Check the protected literals BEFORE the dynamic-root rejection below:
  # `$HOME/Projects` is both "starts with a variable" and a named protected
  # root, and the specific message is the more useful one.
  #
  # This reuses Rule 1's BLOCKED_LITERALS rather than restating the path list.
  # The two previously diverged — Rule 2 covered `/Users/<u>/Projects` but only
  # bare `~`, so `find ~/Projects -delete` was allowed while the identical
  # `find /Users/alice/Projects -delete` was blocked. Sharing one definition
  # means a root can never again be protected against `rm -rf` but not
  # `find -delete`.
  if printf '%s' "$FIND_ROOT" | grep -qE "^${BLOCKED_LITERALS}\$"; then
    deny "find ... -delete rooted at a top-level personal directory."
  fi
  if printf '%s' "$FIND_ROOT" | grep -qE '^\$|`|\$\('; then
    deny "find ... -delete uses a dynamic root path."
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
