#!/usr/bin/env bash
# Install Agent Skills natively for Codex through ~/.agents/skills.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
TARGET="${CODEX_AGENT_SKILLS_DIR:-$HOME/.agents/skills}"
MODE="sync"
SOURCES=()
ALLOWLISTS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCES+=("${2:-}"); shift 2 ;;
    --allowlist) ALLOWLISTS+=("${2:-}"); shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --clean) MODE="clean"; shift ;;
    -h|--help) echo "usage: setup-codex-skills.sh [--source skills-dir] [--target dir] [--check|--clean]"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ "${#SOURCES[@]}" -gt 0 ] || SOURCES=("$REPO_ROOT/skills")
[ "${#ALLOWLISTS[@]}" -gt 0 ] || ALLOWLISTS=("$REPO_ROOT/config/codex-skills.json")

MANIFEST="$TARGET/.buildproven-managed"
mkdir -p "$TARGET"

if [ "$MODE" = clean ]; then
  [ -f "$MANIFEST" ] || exit 0
  while IFS='|' read -r name expected; do
    [ -n "$name" ] || continue
    path="$TARGET/$name"
    if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then rm "$path"; fi
  done < "$MANIFEST"
  rm -f "$MANIFEST"
  exit 0
fi

EXPECTED=$(mktemp "${TMPDIR:-/tmp}/codex-skills.XXXXXX")
cleanup_expected() {
  [ ! -e "$EXPECTED" ] || rm -f "$EXPECTED"
}
trap cleanup_expected EXIT INT TERM
is_allowed() {
  local name="$1" allowlist
  for allowlist in "${ALLOWLISTS[@]}"; do
    [ -f "$allowlist" ] || continue
    if python3 -c 'import json,sys; raise SystemExit(0 if sys.argv[2] in json.load(open(sys.argv[1])).get("skills",[]) else 1)' "$allowlist" "$name"; then
      return 0
    fi
  done
  return 1
}
for source in "${SOURCES[@]}"; do
  [ -d "$source" ] || continue
  for skill in "$source"/*; do
    [ -f "$skill/SKILL.md" ] || continue
    name=$(basename "$skill")
    is_allowed "$name" || continue
    printf '%s|%s\n' "$name" "$skill" >> "$EXPECTED"
  done
done

DRIFT=0
while IFS='|' read -r name expected; do
  path="$TARGET/$name"
  if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then continue; fi
  if [ "$MODE" = check ]; then
    echo "drift: $path -> $expected"
    DRIFT=1
  elif [ -e "$path" ] || [ -L "$path" ]; then
    echo "refusing to replace unmanaged Codex skill: $path" >&2
    DRIFT=1
  else
    ln -s "$expected" "$path"
    echo "linked Codex skill: $name"
  fi
done < "$EXPECTED"

if [ "$MODE" = sync ] && [ "$DRIFT" -eq 0 ]; then mv "$EXPECTED" "$MANIFEST"; fi
[ "$DRIFT" -eq 0 ]
