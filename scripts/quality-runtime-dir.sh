#!/usr/bin/env bash
# Print the canonical directory containing a complete quality runtime cohort.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REQUIRED_SIBLINGS=(
  quality-invocation.js
  quality-run.js
  quality-provider-usage.js
  provider-run.sh
  quality-run-bounded.sh
)

missing=()
for sibling in "${REQUIRED_SIBLINGS[@]}"; do
  [[ -f "$SCRIPT_DIR/$sibling" ]] || missing+=("$sibling")
done
if [[ "${#missing[@]}" -gt 0 ]]; then
  missing_list="$(printf ', %s' "${missing[@]}")"
  missing_list="${missing_list:2}"
  printf 'quality-runtime-dir: incomplete quality runtime cohort beside this helper; missing: %s\n' \
    "$missing_list" >&2
  exit 1
fi
printf '%s\n' "$SCRIPT_DIR"
