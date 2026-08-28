#!/usr/bin/env bash
# Codex models-cache health probe (BUI-352).
#
# THE BUG: codex caches model metadata in $CODEX_HOME/models_cache.json
# (default ~/.codex), tagged with the client_version that wrote it. On a host
# where a NEWER codex also touches the same home — notably the ChatGPT / Codex
# desktop app — the CLI the quality review invokes can't parse it
# ("failed to load/renew models cache: missing field 'supports_reasoning_summaries'").
# codex then stalls resolving models and burns its entire review clock without
# emitting findings (rc=76). This cost ~2h of blocked merges in one session.
#
# The quality runner now gives each installed CLI version its own cache home.
# This guard remains the bounded health check for that private cache.
#
# THE CONTRACT: probe whether the INSTALLED codex can actually use the cache.
#   exit 0  → cache is healthy for the installed codex; run the codex review.
#   exit 1  → cache is structurally unusable here; the caller should treat codex
#             as UNAVAILABLE and go straight to the fallback provider, instead of
#             letting codex waste its whole clock and time out (rc=76). Fast and
#             deterministic — no multi-minute stall.
# A one-shot refresh IS attempted first (it helps the simple stale-file case
# where nothing else owns $CODEX_HOME); exit 1 only after that fails.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
BOUNDED="$SCRIPT_DIR/quality-run-bounded.sh"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CACHE="$CODEX_HOME_DIR/models_cache.json"

# No codex installed → not our problem; let the runner's own `command -v codex`
# check handle it (it returns unavailable → fallback).
command -v codex >/dev/null 2>&1 || exit 0

installed_version="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

cache_is_healthy() {
  # Healthy = file exists, valid JSON, client_version matches the installed
  # codex, and it carries a model object. A version mismatch is the reliable
  # staleness signal; the missing-field parse error follows from it.
  [ -f "$CACHE" ] || return 1
  CACHE="$CACHE" WANT="$installed_version" node -e '
    try {
      const c = JSON.parse(require("fs").readFileSync(process.env.CACHE, "utf8"));
      const m = Array.isArray(c.models) ? c.models[0] : null;
      const versionOk = !process.env.WANT || c.client_version === process.env.WANT;
      const fieldsOk = m && typeof m === "object";
      process.exit(versionOk && fieldsOk ? 0 : 1);
    } catch { process.exit(1); }
  ' >/dev/null 2>&1
}

if cache_is_healthy; then
  exit 0
fi

echo "[quality] codex models-cache stale for installed codex ${installed_version:-unknown}; attempting one refresh." >&2

# One bounded attempt: clear + let codex regenerate. Fixes the simple case where
# nothing else owns $CODEX_HOME. Auth files elsewhere in $CODEX_HOME untouched.
rm -f -- "$CACHE"
if [ -f "$BOUNDED" ]; then
  bash "$BOUNDED" --timeout 20 -- codex exec "ok" >/dev/null 2>&1 || true
else
  codex exec "ok" >/dev/null 2>&1 || true
fi

if cache_is_healthy; then
  echo "[quality] codex models-cache refreshed to the installed schema." >&2
  exit 0
fi

# Still unhealthy. Do not retry and consume the complete provider clock.
echo "[quality] codex models-cache regeneration is incompatible with the installed CLI; skipping codex and using the fallback provider (BUI-352)." >&2
exit 1
