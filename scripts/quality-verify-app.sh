#!/usr/bin/env bash
# quality-verify-app.sh — BUI-306: the "does it actually run" gate.
#
# Every other quality gate (lint/type/build/test) proves the code compiles
# and its unit tests pass. None of them boot the app. This gate closes that
# gap: it detects the project's runtime shape, boots it for real, and (for a
# web project) drives a real browser against it to catch "green but broken
# on load" regressions — a blank page, a render-time throw, a dev server
# that never becomes ready.
#
# Opt-in only (--verify-app on /bs:quality), never part of the default gate
# set: booting a real process/browser is slow and carries more environmental
# flakiness risk than a static gate, so it is not safe to force on every
# campaign by default. See skills/quality/SKILL.md and BUI-306 for the
# discovery wiring (scripts/quality-invocation.js discoverRequiredGates).
#
# Invoked with no arguments, cwd = repository root (this is how
# discoverRequiredGates in quality-invocation.js wires it into requiredGates
# and how quality-run-gate.sh's recording runner executes it, exactly like
# the lint/build/test gates). Reads optional .quality-app-flows.json for
# richer per-repo checks; the zero-config baseline is "boots + loads with no
# console errors" and requires no repo opt-in beyond --verify-app itself.
#
# Project-type detection (npm/package.json only, per BUI-306's scope):
#   web     — package.json scripts.dev or scripts.start exists AND a port
#             can be discovered (from .quality-app-flows.json "port", or a
#             PORT=<n> / --port <n> / -p <n> / :<n> literal in the script
#             command, or the default 3000).
#   server  — scripts.dev or scripts.start exists but no port can be
#             discovered; the process must merely start and stay alive
#             past the boot window without exiting.
#   cli     — no dev/start script, but package.json has a `bin` field;
#             run `<bin> --help` and require exit 0.
#   library — none of the above: no runnable entrypoint. Exits 0 immediately
#             with a clear "not applicable" message. NOTE: the manifest-level
#             `status: "skipped"` path (quality-invocation.js
#             gateEvidenceInput) is hard-restricted to the `test` gate only
#             — every other required gate must report `status: "success"`
#             or the campaign's verifyGateEvidence blocks. A library
#             therefore records a real, clean SUCCESS exit rather than a
#             skip, and says so on stdout so the log is not confusing.
set -u

ROOT="$(pwd -P)"

BOOT_TIMEOUT_SECONDS="${QUALITY_VERIFY_APP_BOOT_TIMEOUT:-45}"
PAGE_TIMEOUT_SECONDS="${QUALITY_VERIFY_APP_PAGE_TIMEOUT:-30}"
FLOWS_FILE="$ROOT/.quality-app-flows.json"

fail() {
  echo "[verify-app] FAIL: $1" >&2
  exit 1
}

# Portable timeout: macOS ships no coreutils `timeout` by default. Mirrors
# scripts/quality-adversarial-verify.sh's run_with_timeout.
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    set -m
    "$@" &
    local pid=$!
    ( sleep "$secs"; kill -TERM "-$pid" 2>/dev/null; sleep 2; kill -KILL "-$pid" 2>/dev/null ) &
    local killer=$!
    wait "$pid"; local rc=$?
    kill -KILL "-$killer" 2>/dev/null
    set +m
    return $rc
  fi
}

if [ ! -f "$ROOT/package.json" ]; then
  echo "[verify-app] not applicable: no package.json at repository root; nothing to boot (SUCCESS, no-op)"
  exit 0
fi

command -v node >/dev/null 2>&1 || fail "node is required to inspect package.json but is not on PATH"

# --- Project-type detection -------------------------------------------------
DEV_SCRIPT="$(node -e '
  const pkg = require(process.argv[1]);
  const scripts = pkg.scripts || {};
  const candidate = ["dev", "start"].find((name) => typeof scripts[name] === "string");
  process.stdout.write(candidate ? scripts[candidate] : "");
' "$ROOT/package.json" 2>/dev/null)"
DEV_SCRIPT_NAME="$(node -e '
  const pkg = require(process.argv[1]);
  const scripts = pkg.scripts || {};
  const candidate = ["dev", "start"].find((name) => typeof scripts[name] === "string");
  process.stdout.write(candidate || "");
' "$ROOT/package.json" 2>/dev/null)"
BIN_FIELD="$(node -e '
  const pkg = require(process.argv[1]);
  const bin = pkg.bin;
  if (typeof bin === "string") { process.stdout.write(bin); }
  else if (bin && typeof bin === "object") {
    const first = Object.values(bin)[0];
    if (typeof first === "string") process.stdout.write(first);
  }
' "$ROOT/package.json" 2>/dev/null)"

PACKAGE_MANAGER="npm"
if [ -f "$ROOT/pnpm-lock.yaml" ]; then PACKAGE_MANAGER="pnpm"
elif [ -f "$ROOT/yarn.lock" ]; then PACKAGE_MANAGER="yarn"
elif [ -f "$ROOT/bun.lock" ] || [ -f "$ROOT/bun.lockb" ]; then PACKAGE_MANAGER="bun"
fi

if [ -z "$DEV_SCRIPT_NAME" ] && [ -n "$BIN_FIELD" ]; then
  # --- CLI: run `<bin> --help`, require a clean exit -----------------------
  echo "[verify-app] detected CLI project (package.json#bin); running '--help'"
  BIN_PATH="$ROOT/$BIN_FIELD"
  [ -f "$BIN_PATH" ] || fail "package.json#bin points at '$BIN_FIELD', which does not exist"
  HELP_OUTPUT="$(run_with_timeout "$BOOT_TIMEOUT_SECONDS" node "$BIN_PATH" --help 2>&1)"
  HELP_STATUS=$?
  if [ "$HELP_STATUS" -eq 124 ]; then
    fail "CLI '$BIN_FIELD --help' did not exit within ${BOOT_TIMEOUT_SECONDS}s"
  fi
  if [ "$HELP_STATUS" -ne 0 ]; then
    echo "$HELP_OUTPUT" >&2
    fail "CLI '$BIN_FIELD --help' exited with status $HELP_STATUS"
  fi
  echo "[verify-app] SUCCESS: CLI '$BIN_FIELD --help' exited 0"
  exit 0
fi

if [ -z "$DEV_SCRIPT_NAME" ]; then
  # --- Library: no dev/start script and no bin — nothing to boot -----------
  echo "[verify-app] not applicable: no scripts.dev, scripts.start, or package.json#bin found (SUCCESS, no-op library gate)"
  exit 0
fi

# Port discovery, in priority order: .quality-app-flows.json "port", then a
# literal PORT=<n> / --port <n> / -p <n> / :<n> in the dev/start command,
# then the conventional default of 3000. This intentionally does not try to
# read a running server's actual bound port — that would require the process
# to already be up, which is exactly what we're about to find out.
PORT=""
if [ -f "$FLOWS_FILE" ]; then
  PORT="$(node -e '
    try {
      const cfg = require(process.argv[1]);
      if (Number.isInteger(cfg.port)) process.stdout.write(String(cfg.port));
    } catch { /* malformed flows file falls through to script-derived port */ }
  ' "$FLOWS_FILE" 2>/dev/null)"
fi
if [ -z "$PORT" ]; then
  PORT="$(printf '%s' "$DEV_SCRIPT" | grep -oE '(PORT=|--port[= ]|-p )[0-9]{2,5}' | grep -oE '[0-9]{2,5}' | head -1)"
fi
if [ -z "$PORT" ]; then
  PORT="$(printf '%s' "$DEV_SCRIPT" | grep -oE ':[0-9]{2,5}\b' | grep -oE '[0-9]{2,5}' | head -1)"
fi
[ -n "$PORT" ] || PORT=3000

wait_for_port() {
  local port="$1" deadline
  deadline=$((SECONDS + BOOT_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      exec 3>&- 3<&-
      return 0
    fi
    sleep 1
  done
  return 1
}

DEV_LOG="$(mktemp -t quality-verify-app-boot.XXXXXX)"
cleanup() {
  if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill -TERM "-$DEV_PID" 2>/dev/null || kill -TERM "$DEV_PID" 2>/dev/null
    sleep 1
    kill -KILL "-$DEV_PID" 2>/dev/null || kill -KILL "$DEV_PID" 2>/dev/null
  fi
  rm -f "$DEV_LOG"
}
trap cleanup EXIT INT TERM

echo "[verify-app] booting '$PACKAGE_MANAGER run $DEV_SCRIPT_NAME' (expecting port $PORT, ${BOOT_TIMEOUT_SECONDS}s budget)"
set -m
PORT="$PORT" "$PACKAGE_MANAGER" run "$DEV_SCRIPT_NAME" >"$DEV_LOG" 2>&1 &
DEV_PID=$!
set +m

if ! wait_for_port "$PORT"; then
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "--- boot log ---" >&2
    cat "$DEV_LOG" >&2
    fail "'$DEV_SCRIPT_NAME' exited before binding port $PORT (process is no longer running)"
  fi
  echo "--- boot log (partial) ---" >&2
  cat "$DEV_LOG" >&2
  fail "'$DEV_SCRIPT_NAME' did not bind port $PORT within ${BOOT_TIMEOUT_SECONDS}s"
fi
echo "[verify-app] port $PORT is accepting connections"

# --- Server-only path: no browser check, just confirm it stays up --------
# "Web" is decided by probing the booted port for an actual HTML response,
# not by guessing from package.json dependencies — that covers plain HTML,
# every framework, and correctly excludes non-HTTP servers (gRPC, raw TCP,
# a JSON-only API) without a hardcoded framework allowlist.
IS_WEB=0
if command -v curl >/dev/null 2>&1; then
  PROBE_BODY="$(mktemp -t quality-verify-app-probe.XXXXXX)"
  RESPONSE_HEADERS="$(curl -sS -m 5 -o "$PROBE_BODY" -D - "http://127.0.0.1:$PORT/" 2>/dev/null || true)"
  if printf '%s' "$RESPONSE_HEADERS" | grep -qi '^content-type:.*text/html'; then
    IS_WEB=1
  elif grep -qi '<html' "$PROBE_BODY" 2>/dev/null; then
    IS_WEB=1
  fi
  rm -f "$PROBE_BODY"
fi

if [ "$IS_WEB" != "1" ]; then
  sleep 2
  kill -0 "$DEV_PID" 2>/dev/null || {
    cat "$DEV_LOG" >&2
    fail "'$DEV_SCRIPT_NAME' bound port $PORT but the process exited immediately after"
  }
  echo "[verify-app] SUCCESS: server process is listening on port $PORT and stayed up (non-HTML response, skipping browser check)"
  exit 0
fi

# --- Web path: drive a real browser against the booted server ------------
command -v agent-browser >/dev/null 2>&1 || fail "agent-browser is required for web project verification but is not on PATH (npm install -g agent-browser / brew install agent-browser)"

SESSION="quality-verify-app-$$"
BASE_URL="http://127.0.0.1:$PORT"

ab() { agent-browser --session "$SESSION" "$@"; }

ab_cleanup() { ab close >/dev/null 2>&1 || true; }
trap 'ab_cleanup; cleanup' EXIT INT TERM

echo "[verify-app] loading $BASE_URL"
if ! run_with_timeout "$PAGE_TIMEOUT_SECONDS" agent-browser --session "$SESSION" open "$BASE_URL"; then
  fail "agent-browser could not load $BASE_URL"
fi
ab wait --load networkidle >/dev/null 2>&1 || true

ERRORS_JSON="$(ab errors --json 2>/dev/null)"
ERROR_COUNT="$(printf '%s' "$ERRORS_JSON" | jq '(.data.errors // []) | length' 2>/dev/null)"
if [ -z "$ERROR_COUNT" ]; then
  fail "could not parse agent-browser 'errors --json' output: $ERRORS_JSON"
fi
if [ "$ERROR_COUNT" -gt 0 ]; then
  echo "--- page errors ---" >&2
  printf '%s' "$ERRORS_JSON" | jq -r '.data.errors[] | "  " + .text' >&2 2>/dev/null || printf '%s\n' "$ERRORS_JSON" >&2
  fail "root page produced $ERROR_COUNT JavaScript error(s) on load"
fi

CONSOLE_JSON="$(ab console --json 2>/dev/null)"
CONSOLE_ERROR_COUNT="$(printf '%s' "$CONSOLE_JSON" | jq '[(.data.messages // [])[] | select(.type == "error")] | length' 2>/dev/null)"
if [ -n "$CONSOLE_ERROR_COUNT" ] && [ "$CONSOLE_ERROR_COUNT" -gt 0 ]; then
  echo "--- console.error output ---" >&2
  printf '%s' "$CONSOLE_JSON" | jq -r '.data.messages[] | select(.type == "error") | "  " + .text' >&2 2>/dev/null || true
  fail "root page logged $CONSOLE_ERROR_COUNT console.error message(s) on load"
fi

echo "[verify-app] root page loaded cleanly: 0 page errors, 0 console.error messages"

# --- Optional richer flows from .quality-app-flows.json --------------------
# Zero-config baseline (above) is the whole gate for a repo that declares
# nothing. A repo that wants deeper checks can opt in with:
#   { "port": 3000, "flows": [ { "name": "...", "steps": ["open /login", "wait --load networkidle", "click @e1"] } ] }
# Each step is one literal agent-browser subcommand+args (no shell metachars,
# no chaining); this gate runs them in order and fails the same way as the
# baseline load if any step's exit code is non-zero.
if [ -f "$FLOWS_FILE" ]; then
  FLOW_COUNT="$(node -e '
    try {
      const cfg = require(process.argv[1]);
      process.stdout.write(String(Array.isArray(cfg.flows) ? cfg.flows.length : 0));
    } catch { process.stdout.write("0"); }
  ' "$FLOWS_FILE" 2>/dev/null)"
  if [ -n "$FLOW_COUNT" ] && [ "$FLOW_COUNT" -gt 0 ]; then
    echo "[verify-app] running $FLOW_COUNT declared flow(s) from .quality-app-flows.json"
    for ((flow_index = 0; flow_index < FLOW_COUNT; flow_index += 1)); do
      FLOW_NAME="$(node -e '
        const cfg = require(process.argv[1]);
        process.stdout.write(String(cfg.flows[Number(process.argv[2])]?.name || `flow-${process.argv[2]}`));
      ' "$FLOWS_FILE" "$flow_index" 2>/dev/null)"
      STEP_COUNT="$(node -e '
        const cfg = require(process.argv[1]);
        process.stdout.write(String((cfg.flows[Number(process.argv[2])]?.steps || []).length));
      ' "$FLOWS_FILE" "$flow_index" 2>/dev/null)"
      echo "[verify-app] flow '$FLOW_NAME' ($STEP_COUNT step(s))"
      for ((step_index = 0; step_index < STEP_COUNT; step_index += 1)); do
        STEP_ARGS_JSON="$(node -e '
          const cfg = require(process.argv[1]);
          const step = cfg.flows[Number(process.argv[2])].steps[Number(process.argv[3])];
          process.stdout.write(JSON.stringify(String(step).split(" ")));
        ' "$FLOWS_FILE" "$flow_index" "$step_index" 2>/dev/null)"
        readarray -t STEP_ARGS < <(printf '%s' "$STEP_ARGS_JSON" | node -e 'process.stdin.on("data", (d) => JSON.parse(d).forEach((s) => process.stdout.write(s + "\n")))')
        if ! ab "${STEP_ARGS[@]}" >/dev/null 2>&1; then
          fail "flow '$FLOW_NAME' step $((step_index + 1)) failed: agent-browser ${STEP_ARGS[*]}"
        fi
      done
      FLOW_ERRORS="$(ab errors --json 2>/dev/null | jq '(.data.errors // []) | length' 2>/dev/null)"
      if [ -n "$FLOW_ERRORS" ] && [ "$FLOW_ERRORS" -gt 0 ]; then
        fail "flow '$FLOW_NAME' produced $FLOW_ERRORS JavaScript error(s)"
      fi
      echo "[verify-app] flow '$FLOW_NAME' passed"
    done
  fi
fi

echo "[verify-app] SUCCESS: app booted and root page (+ declared flows) verified clean"
exit 0
