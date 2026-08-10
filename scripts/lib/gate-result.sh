#!/usr/bin/env bash
# Shared PASS/FAIL/SKIP result protocol for scripts/verify child gates.
#
# A child gate may print human diagnostics, but it must finish with exactly one
# JSON envelope. The EXIT trap covers every early-return path, including
# `set -e` failures, so an unhandled exit cannot look like a pass.

gate_result_init() {
  GATE_RESULT_CHECKS=0
  GATE_RESULT_STATUS=""
  GATE_RESULT_REASON=""
  GATE_RESULT_EMITTED=0
  trap '_gate_result_on_exit "$?"' EXIT
}

gate_result_check() {
  GATE_RESULT_CHECKS=$((GATE_RESULT_CHECKS + 1))
}

gate_result_pass() {
  GATE_RESULT_STATUS="PASS"
  GATE_RESULT_REASON="${1:-gate completed}"
}

gate_result_skip() {
  GATE_RESULT_STATUS="SKIP"
  GATE_RESULT_REASON="${1:-gate was not run}"
}

gate_result_fail() {
  GATE_RESULT_STATUS="FAIL"
  GATE_RESULT_REASON="${1:-gate failed}"
}

_gate_result_emit() {
  local status="$1" checks="$2" reason="$3"
  [ "${GATE_RESULT_EMITTED:-0}" -eq 0 ] || return 0
  GATE_RESULT_EMITTED=1
  node - "$status" "$checks" "$reason" <<'NODE'
const [, , status, checks, reason] = process.argv
process.stdout.write(`${JSON.stringify({ status, checks: Number(checks), reason })}\n`)
NODE
}

_gate_result_on_exit() {
  local rc="$1"
  local status="${GATE_RESULT_STATUS:-}"
  local checks="${GATE_RESULT_CHECKS:-0}"
  local reason="${GATE_RESULT_REASON:-}"

  if [ -z "$status" ]; then
    if [ "$rc" -eq 0 ]; then
      status="PASS"
      reason="gate completed without declaring a result"
    else
      status="FAIL"
      reason="gate exited with status $rc"
    fi
  fi

  if [ "$status" = "PASS" ] && [ "$checks" -lt 1 ]; then
    status="FAIL"
    reason="PASS requires at least one completed check"
    rc=1
  fi
  if [ "$status" = "SKIP" ] && [ -z "$reason" ]; then
    status="FAIL"
    reason="SKIP requires a non-empty reason"
    rc=1
  fi

  _gate_result_emit "$status" "$checks" "$reason"
  exit "$rc"
}
