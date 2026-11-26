#!/usr/bin/env bash
# Start the CloudCLI web UI for Claude Code on a PRIVATE Unix socket (no TCP port).
#
# The socket lives in a 0700 directory on local disk, so other users on this
# shared host cannot connect. Reach it from your laptop with laptop/tunnel.sh.
# Usually launched by ./up.sh together with the voice server and the gate.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.sh"

export CLOUDCLI_SOCK="$SOCK_DIR/sock"
export SERVER_PORT="${SERVER_PORT:-3001}"     # only used as the "which listen to redirect" key
export HOST=127.0.0.1                         # fallback if the redirect ever fails; never 0.0.0.0
export NODE_OPTIONS="--require $HERE/unix-listen.cjs ${NODE_OPTIONS:-}"

# Voice input: CloudCLI shows the mic button only when a speech-to-text backend is set.
if [ -n "${STT_API_KEY:-}" ]; then
  export VOICE_API_BASE_URL="http://127.0.0.1:${STT_PORT}/v1"
  export VOICE_API_KEY="$STT_API_KEY"
fi

echo "CloudCLI socket: $CLOUDCLI_SOCK"
exec cloudcli "$@"
