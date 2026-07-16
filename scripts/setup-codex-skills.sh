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

if [ "$MODE" = clean ]; then
  [ -d "$TARGET" ] || exit 0
  [ -f "$MANIFEST" ] || exit 0
  while IFS='|' read -r name expected; do
    [ -n "$name" ] || continue
    path="$TARGET/$name"
    if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then rm "$path"; fi
  done < "$MANIFEST"
  rm -f "$MANIFEST"
  exit 0
fi

for source in "${SOURCES[@]}"; do
  [ -d "$source" ] || { echo "Codex skill source not found: $source" >&2; exit 1; }
done
for allowlist in "${ALLOWLISTS[@]}"; do
  [ -f "$allowlist" ] || { echo "Codex skill allowlist not found: $allowlist" >&2; exit 1; }
  python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        payload = json.load(handle)
except (OSError, json.JSONDecodeError) as error:
    print(f"Invalid Codex skill allowlist {sys.argv[1]}: {error}", file=sys.stderr)
    raise SystemExit(1)
skills = payload.get("skills") if isinstance(payload, dict) else None
if not isinstance(skills, list) or any(not isinstance(name, str) or not name.strip() for name in skills):
    print(f"Invalid Codex skill allowlist {sys.argv[1]}: skills must be an array of non-empty strings", file=sys.stderr)
    raise SystemExit(1)
' "$allowlist" || exit 1
done

mkdir -p "$TARGET"

EXPECTED=$(mktemp "${TMPDIR:-/tmp}/codex-skills.XXXXXX")
cleanup_expected() {
  [ ! -e "$EXPECTED" ] || rm -f "$EXPECTED"
}
trap cleanup_expected EXIT INT TERM
is_allowed() {
  local name="$1" allowlist
  for allowlist in "${ALLOWLISTS[@]}"; do
    if python3 -c 'import json,sys; raise SystemExit(0 if sys.argv[2] in json.load(open(sys.argv[1], encoding="utf-8"))["skills"] else 1)' "$allowlist" "$name"; then
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
expected_target_for() {
  local wanted="$1"
  awk -F'|' -v wanted="$wanted" '$1 == wanted { print $2; exit }' "$EXPECTED"
}

# Validate the complete desired state before mutating anything. A conflict at
# one destination must not leave stale managed links removed elsewhere.
if [ "$MODE" = sync ]; then
  while IFS='|' read -r name expected; do
    path="$TARGET/$name"
    if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then continue; fi
    if [ -e "$path" ] || [ -L "$path" ]; then
      echo "refusing to replace unmanaged Codex skill: $path" >&2
      DRIFT=1
    fi
  done < "$EXPECTED"
  [ "$DRIFT" -eq 0 ] || exit 1
fi

# Remove only links recorded in the previous managed manifest whose exact
# targets still match. Never infer ownership from a filename.
if [ -f "$MANIFEST" ]; then
  while IFS='|' read -r old_name old_target; do
    [ -n "$old_name" ] || continue
    [ -z "$(expected_target_for "$old_name")" ] || continue
    old_path="$TARGET/$old_name"
    if [ -L "$old_path" ] && [ "$(readlink "$old_path")" = "$old_target" ]; then
      if [ "$MODE" = check ]; then
        echo "stale: $old_path"
        DRIFT=1
      else
        rm "$old_path"
        echo "removed stale managed Codex skill: $old_name"
      fi
    fi
  done < "$MANIFEST"
fi

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
