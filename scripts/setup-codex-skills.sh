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
LOCK_DIR="$TARGET/.buildproven-sync.lock"
LOCK_HELD=false

acquire_lock() {
  mkdir -p "$TARGET"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Codex skill sync already in progress: $TARGET" >&2
    exit 1
  fi
  LOCK_HELD=true
}

release_lock() {
  if [ "$LOCK_HELD" = true ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    LOCK_HELD=false
  fi
}

if [ "$MODE" = clean ]; then
  [ -d "$TARGET" ] || exit 0
  acquire_lock
  if [ -f "$MANIFEST" ]; then
    while IFS='|' read -r name expected; do
      [ -n "$name" ] || continue
      path="$TARGET/$name"
      if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then rm "$path"; fi
    done < "$MANIFEST"
    rm -f "$MANIFEST"
  fi
  release_lock
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
if not isinstance(skills, list) or any(
    not isinstance(name, str) or not name or name != name.strip()
    for name in skills
):
    print(f"Invalid Codex skill allowlist {sys.argv[1]}: skills must be canonical non-empty strings", file=sys.stderr)
    raise SystemExit(1)
' "$allowlist" || exit 1
done

acquire_lock
EXPECTED=$(mktemp "${TMPDIR:-/tmp}/codex-skills.XXXXXX")
REQUESTED=$(mktemp "${TMPDIR:-/tmp}/codex-skills-requested.XXXXXX")
NEXT_EXPECTED=$(mktemp "${TMPDIR:-/tmp}/codex-skills-next.XXXXXX")
ORIGINAL=$(mktemp "${TMPDIR:-/tmp}/codex-skills-original.XXXXXX")
CREATED=$(mktemp "${TMPDIR:-/tmp}/codex-skills-created.XXXXXX")
BACKUP_DIR=$(mktemp -d "$TARGET/.buildproven-backup.XXXXXX")
COMMITTED=false
cleanup_expected() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$COMMITTED" = false ]; then
    while IFS='|' read -r name expected; do
      [ -n "$name" ] || continue
      path="$TARGET/$name"
      if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then rm "$path"; fi
    done < "$CREATED"
    while IFS='|' read -r name previous; do
      [ -n "$name" ] || continue
      path="$TARGET/$name"
      backup="$BACKUP_DIR/$name"
      if [ ! -e "$path" ] && [ ! -L "$path" ] && [ -L "$backup" ]; then
        mv "$backup" "$path"
      fi
    done < "$ORIGINAL"
  fi
  [ ! -e "$EXPECTED" ] || rm -f "$EXPECTED"
  [ ! -e "$REQUESTED" ] || rm -f "$REQUESTED"
  [ ! -e "$NEXT_EXPECTED" ] || rm -f "$NEXT_EXPECTED"
  [ ! -e "$ORIGINAL" ] || rm -f "$ORIGINAL"
  [ ! -e "$CREATED" ] || rm -f "$CREATED"
  for backup in "$BACKUP_DIR"/*; do [ ! -L "$backup" ] || rm "$backup"; done
  rmdir "$BACKUP_DIR" 2>/dev/null || true
  release_lock
  return "$status"
}
trap cleanup_expected EXIT
trap 'exit 130' INT TERM

for allowlist in "${ALLOWLISTS[@]}"; do
  python3 -c 'import json,sys; print(*json.load(open(sys.argv[1], encoding="utf-8"))["skills"], sep="\n")' \
    "$allowlist" >> "$REQUESTED"
done
sort -u "$REQUESTED" -o "$REQUESTED"

# Sources are ordered from lowest to highest precedence. Replacing the mapping
# here prevents duplicate names from becoming a partial filesystem mutation.
for source in "${SOURCES[@]}"; do
  for skill in "$source"/*; do
    [ -f "$skill/SKILL.md" ] || continue
    name=$(basename "$skill")
    grep -Fqx "$name" "$REQUESTED" || continue
    awk -F'|' -v name="$name" '$1 != name' "$EXPECTED" > "$NEXT_EXPECTED"
    mv "$NEXT_EXPECTED" "$EXPECTED"
    NEXT_EXPECTED=$(mktemp "${TMPDIR:-/tmp}/codex-skills-next.XXXXXX")
    printf '%s|%s\n' "$name" "$skill" >> "$EXPECTED"
  done
done

DRIFT=0
expected_target_for() {
  local wanted="$1"
  awk -F'|' -v wanted="$wanted" '$1 == wanted { print $2; exit }' "$EXPECTED"
}

previous_target_for() {
  local wanted="$1"
  [ -f "$MANIFEST" ] || return 0
  awk -F'|' -v wanted="$wanted" '$1 == wanted { print $2; exit }' "$MANIFEST"
}

# Every requested name must resolve before any installed state changes.
while IFS= read -r requested_name; do
  [ -n "$requested_name" ] || continue
  if [ -z "$(expected_target_for "$requested_name")" ]; then
    echo "Codex skill not found in configured sources: $requested_name" >&2
    exit 1
  fi
done < "$REQUESTED"

# Validate the complete desired state before mutating anything. A conflict at
# one destination must not leave stale managed links removed elsewhere.
if [ "$MODE" = sync ]; then
  while IFS='|' read -r name expected; do
    path="$TARGET/$name"
    if [ -L "$path" ] && [ "$(readlink "$path")" = "$expected" ]; then continue; fi
    previous=$(previous_target_for "$name")
    if [ -n "$previous" ] && [ -L "$path" ] && [ "$(readlink "$path")" = "$previous" ]; then
      continue
    fi
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
        printf '%s|%s\n' "$old_name" "$old_target" >> "$ORIGINAL"
        mv "$old_path" "$BACKUP_DIR/$old_name"
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
  else
    previous=$(previous_target_for "$name")
    if [ -n "$previous" ] && [ -L "$path" ] && [ "$(readlink "$path")" = "$previous" ]; then
      printf '%s|%s\n' "$name" "$previous" >> "$ORIGINAL"
      mv "$path" "$BACKUP_DIR/$name"
    elif [ -e "$path" ] || [ -L "$path" ]; then
      echo "refusing to replace unmanaged Codex skill: $path" >&2
      DRIFT=1
      continue
    fi
    ln -s "$expected" "$path"
    printf '%s|%s\n' "$name" "$expected" >> "$CREATED"
    echo "linked Codex skill: $name"
  fi
done < "$EXPECTED"

if [ "$MODE" = sync ] && [ "$DRIFT" -eq 0 ]; then
  mv "$EXPECTED" "$MANIFEST"
  COMMITTED=true
fi
[ "$DRIFT" -eq 0 ]
