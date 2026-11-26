#!/usr/bin/env bash
# Device-approval gate: $SOCK_DIR/gate.sock -> CloudCLI. Point any public tunnel at gate.sock.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.sh"
export GATE_SOCK="$SOCK_DIR/gate.sock" UPSTREAM_SOCK="$SOCK_DIR/sock"
exec node "$HERE/gate.cjs" serve
