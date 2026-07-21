#!/usr/bin/env bash
# Compatibility wrapper. Provider policy now applies to every model-using workflow.
set -euo pipefail
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BS_PROVIDER_ALLOW_GEMINI=1 exec "$SCRIPT_DIR/provider-config.sh" "$@"
