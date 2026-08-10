#!/usr/bin/env bash
# Execute one verify child and ensure its output has one machine-readable
# result. Legacy npm commands are wrapped here; native gates can source
# gate-result.sh and emit their own richer check count.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
NAME="${1:-}"
shift || true
MODE="legacy"
if [ "${1:-}" = "--native" ]; then
  MODE="native"
  shift
fi
[ -n "$NAME" ] && [ "$#" -gt 0 ] || {
  echo "usage: run-gate.sh <name> <command> [args...]" >&2
  exit 2
}

LOG="$(mktemp "${TMPDIR:-/tmp}/verify-child-${NAME}.XXXXXX")" || exit 1
trap 'rm -f "$LOG"' EXIT

"$@" >"$LOG" 2>&1
GATE_STATUS=$?

INSPECTION="$(node "$ROOT/scripts/lib/gate-result.js" inspect "$LOG")" || {
  cat "$LOG"
  exit 1
}
ENVELOPE_COUNT="$(printf '%s' "$INSPECTION" | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).envelopes.length)))')"
INVALID_COUNT="$(printf '%s' "$INSPECTION" | node -e 'let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).invalid.length)))')"

if [ "$INVALID_COUNT" -gt 0 ] || [ "$ENVELOPE_COUNT" -gt 1 ]; then
  cat "$LOG"
  echo "❌ gate $NAME emitted an invalid or duplicate result envelope" >&2
  exit 1
fi

if [ "$ENVELOPE_COUNT" -eq 1 ]; then
  cat "$LOG"
  exit "$GATE_STATUS"
fi

if [ "$MODE" = "native" ]; then
  cat "$LOG"
  echo "❌ native gate $NAME exited without exactly one result envelope" >&2
  exit 1
fi

# Commands that have not yet adopted the native helper are still represented
# by a single envelope owned by this wrapper. A successful command with no
# checks is never accepted as PASS; the wrapper records the command itself as
# the one completed check. Explicit SKIP output remains a policy decision made
# by the parent verify runner.
cat "$LOG"
if [ "$GATE_STATUS" -ne 0 ]; then
  node - "$NAME" "$GATE_STATUS" <<'NODE'
const [name, exitCode] = process.argv.slice(2)
process.stdout.write(`${JSON.stringify({
  status: 'FAIL',
  checks: 1,
  reason: `${name} command exited with status ${exitCode}`,
})}\n`)
NODE
  exit "$GATE_STATUS"
fi

if grep -q '^SKIP:' "$LOG"; then
  reason="$(grep '^SKIP:' "$LOG" | head -1 | sed 's/^SKIP:[[:space:]]*//')"
  node - "$reason" <<'NODE'
const reason = process.argv[2]
process.stdout.write(`${JSON.stringify({ status: 'SKIP', checks: 0, reason })}\n`)
NODE
else
  node - "$NAME" <<'NODE'
const name = process.argv[2]
process.stdout.write(`${JSON.stringify({ status: 'PASS', checks: 1, reason: `${name} command completed` })}\n`)
NODE
fi
