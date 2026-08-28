#!/usr/bin/env bash
# Create the Codex home used by quality review.
#
# The desktop app and CLI can write incompatible model caches. Keep review
# cache state private to the installed CLI version while reusing only the
# operator's authentication file.

set -eu

source_home="${QUALITY_CODEX_SOURCE_HOME:-${CODEX_HOME:-$HOME/.codex}}"
version="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ -n "$version" ] || {
  echo "quality-codex-home: cannot resolve the installed Codex version" >&2
  exit 1
}

state_root="${QUALITY_CODEX_STATE_ROOT:-$source_home/quality-state/codex-homes}"
review_home="$state_root/$version"
mkdir -p "$review_home"
chmod 700 "$state_root" "$review_home" 2>/dev/null || true

source_auth="$source_home/auth.json"
review_auth="$review_home/auth.json"
if [ -e "$source_auth" ]; then
  if [ -e "$review_auth" ] || [ -L "$review_auth" ]; then
    [ -L "$review_auth" ] && [ "$(readlink "$review_auth")" = "$source_auth" ] || {
      echo "quality-codex-home: $review_auth does not point to the source authentication file" >&2
      exit 1
    }
  else
    ln -s "$source_auth" "$review_auth"
  fi
fi

printf '%s\n' "$review_home"
