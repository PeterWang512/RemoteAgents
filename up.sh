#!/usr/bin/env bash
# Start (or restart) everything in one tmux session "cloudcli":
#   window cloudcli : CloudCLI on $SOCK_DIR/sock
#   window voice    : local Whisper STT on 127.0.0.1:$STT_PORT (API-key protected)
#   window gate     : device-approval gate on $SOCK_DIR/gate.sock
# Usage: ./up.sh        Stop: tmux kill-session -t cloudcli
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f local.env ] || cp local.env.example local.env
chmod 600 local.env
if ! grep -q '^STT_API_KEY=' local.env; then
  echo "STT_API_KEY=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> local.env
fi
tmux kill-session -t cloudcli 2>/dev/null || true
tmux new-session -d -s cloudcli -n cloudcli ./start.sh
tmux new-window  -t cloudcli -n voice ./voice/start.sh
tmux new-window  -t cloudcli -n gate  ./gate.sh
echo "started: tmux attach -t cloudcli   (windows: cloudcli, voice, gate)"
