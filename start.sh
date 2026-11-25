#!/usr/bin/env bash
# Start the CloudCLI web UI for Claude Code on a PRIVATE Unix socket (no TCP port).
#
# The socket lives in a 0700 directory on local disk, so other users on this
# shared host cannot connect. Reach it from your laptop with laptop/tunnel.sh.
#
# Usage:  tmux new -d -s cloudcli ./start.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Optional per-machine settings (NODE_HOME, SOCK_DIR, ...). See local.env.example.
[ -f "$HERE/local.env" ] && source "$HERE/local.env"

if [ -n "${NODE_HOME:-}" ]; then export PATH="$NODE_HOME/bin:$PATH"; fi
export PATH="$HERE/node_modules/.bin:$PATH"

SOCK_DIR="${SOCK_DIR:-/tmp/cloudcli-$USER}"   # must be LOCAL disk: AFS/NFS can't hold sockets
mkdir -p "$SOCK_DIR" && chmod 700 "$SOCK_DIR"

export CLOUDCLI_SOCK="$SOCK_DIR/sock"
export SERVER_PORT="${SERVER_PORT:-3001}"     # only used as the "which listen to redirect" key
export HOST=127.0.0.1                         # fallback if the redirect ever fails; never 0.0.0.0
export NODE_OPTIONS="--require $HERE/unix-listen.cjs ${NODE_OPTIONS:-}"

echo "CloudCLI socket: $CLOUDCLI_SOCK"
exec cloudcli "$@"
