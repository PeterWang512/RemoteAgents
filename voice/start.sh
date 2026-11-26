#!/usr/bin/env bash
# Local Whisper speech-to-text on CPU, for CloudCLI's mic button.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$HERE/env.sh"
: "${STT_API_KEY:?set STT_API_KEY in local.env (up.sh generates one)}"
exec "$HERE/voice/.venv/bin/python" "$HERE/voice/stt_server.py"
