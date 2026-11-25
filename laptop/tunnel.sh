#!/usr/bin/env bash
# Run on your LAPTOP. Forwards http://localhost:3001 to CloudCLI's private
# socket on the CSAIL host, and reconnects if the connection drops.
#
# Usage:  ./tunnel.sh [ssh-host] [remote-user] [local-port]
#         ./tunnel.sh torralba-3090-4 shengyu 3001
set -u
HOST="${1:-torralba-3090-4}"
RUSER="${2:-$USER}"
LPORT="${3:-3001}"
SOCK="/tmp/cloudcli-$RUSER/sock"

echo "http://localhost:$LPORT  ->  $HOST:$SOCK   (Ctrl-C to stop)"
while true; do
  ssh -N \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -L "127.0.0.1:$LPORT:$SOCK" "$HOST"
  echo "tunnel dropped ($?); reconnecting in 5s... (re-run kinit if auth fails)"
  sleep 5
done
