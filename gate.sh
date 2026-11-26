#!/usr/bin/env bash
# Device-approval gate in front of CloudCLI.
#   always:            $SOCK_DIR/gate.sock (private)
#   if PUBLIC_PORT set: https://0.0.0.0:$PUBLIC_PORT with a self-signed cert (made on first run)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/env.sh"
export GATE_SOCK="$SOCK_DIR/gate.sock" UPSTREAM_SOCK="$SOCK_DIR/sock"
export PUBLIC_PORT="${PUBLIC_PORT:-}" PUBLIC_HOST="${PUBLIC_HOST:-0.0.0.0}"
if [ -n "$PUBLIC_PORT" ]; then
  TLS_DIR="${TLS_DIR:-$HOME/.cloudcli/tls}"
  export TLS_KEY="$TLS_DIR/key.pem" TLS_CERT="$TLS_DIR/cert.pem"
  if [ ! -f "$TLS_CERT" ]; then
    mkdir -p "$TLS_DIR"; FQDN="$(hostname -f)"
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 825 \
      -keyout "$TLS_KEY" -out "$TLS_CERT" -subj "/CN=$FQDN" -addext "subjectAltName=DNS:$FQDN" 2>/dev/null
    chmod 600 "$TLS_KEY"
  fi
  echo "TLS cert SHA-256 fingerprint (check this when your phone warns about the cert):"
  openssl x509 -in "$TLS_CERT" -noout -fingerprint -sha256
fi
exec node "$HERE/gate.cjs" serve
