# Shared settings, sourced by the launch scripts. Per-machine overrides go in local.env.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/local.env" ] && source "$HERE/local.env"
if [ -n "${NODE_HOME:-}" ]; then export PATH="$NODE_HOME/bin:$PATH"; fi
export PATH="$HERE/node_modules/.bin:$PATH"
SOCK_DIR="${SOCK_DIR:-/tmp/cloudcli-$USER}"     # must be LOCAL disk: AFS/NFS can't hold sockets
mkdir -p "$SOCK_DIR" && chmod 700 "$SOCK_DIR"
export STT_PORT="${STT_PORT:-8765}"
export STT_API_KEY="${STT_API_KEY:-}"
