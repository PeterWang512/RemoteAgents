# CloudCLI on CSAIL

A phone/laptop web UI for the Claude Code sessions on a CSAIL machine, standing in for
`claude /remote-control` (disabled by our organization).

It runs [CloudCLI](https://github.com/siteboon/claudecodeui) (`@cloudcli-ai/cloudcli`) on a private
Unix socket and puts a **device-approval gate** in front of it as the only public entry point, served
over HTTPS. It also adds **voice input** transcribed locally by Whisper.

```
phone / laptop ──https://<host>:8443 (self-signed)──> gate ──> /tmp/cloudcli-<you>/sock ── CloudCLI
                                                       │                                   │
                                       unknown device? show code,                 Claude Code sessions
                                       wait for ./devices approve                 in ~/.claude
                                                                                           │
                                                          mic audio ──> Whisper STT, 127.0.0.1:8765 (API key)
```

> **Policy caveat.** Serving this publicly from a CSAIL host may conflict with TIG's rules on
> exposing services/bypassing the jump host. Your call; stop if TIG objects.

## Security model

You pass three checks to use the UI:

1. **Device gate**: unknown browsers get a code and nothing else (not even the login page) until you run
   `./devices approve <CODE>` on the CSAIL host. Only cookie hashes are stored (`~/.cloudcli/devices.json`).
2. **CloudCLI login**: single user account, bcrypt-hashed password, 7-day signed session tokens.
3. **TLS**: HTTPS only, so the password and cookies aren't sent in clear text. Self-signed: check the fingerprint once per device.

Behind the gate, CloudCLI itself listens on no TCP port. A port on `127.0.0.1` would be reachable by every
user on a shared host, so `unix-listen.cjs` moves it to a socket only your user can open (dir 0700, socket 0600).
The STT server does listen on 127.0.0.1, so it requires a random API key (`STT_API_KEY` in `local.env`, mode 600).
Account data and device list live in `~/.cloudcli/` (on AFS, other users get lookup-only, no read).

## Files

| File | What it does |
|---|---|
| `up.sh` | Starts everything in tmux session `cloudcli` (windows: cloudcli, voice, gate) |
| `start.sh` | Starts CloudCLI on the private socket, with voice config |
| `unix-listen.cjs` | Node preload that redirects CloudCLI's TCP listen to the socket |
| `gate.cjs`, `gate.sh` | Device gate (HTTP + WebSocket proxy); HTTPS on `PUBLIC_PORT`, self-signed cert |
| `devices` | `list` / `approve <CODE> [name]` / `revoke <name>` |
| `voice/stt_server.py`, `voice/start.sh` | OpenAI-compatible Whisper speech-to-text on CPU |
| `env.sh` | Shared settings sourced by the scripts |
| `local.env.example` | Per-machine settings; copy to `local.env` (git-ignored) |
| `package.json` / `package-lock.json` | Pins the CloudCLI version |

## Setup (once, on the CSAIL host)

`claude` must already work and be logged in on this host; CloudCLI reuses that login.

```bash
# 1. Node >= 22 on NFS (skip if `node --version` already says v22+)
micromamba create -p /data/vision/torralba/u/$USER/envs/node22 -c conda-forge nodejs=22 -y

# 2. Get this repo and install pinned deps
git clone <this-repo-url> /data/vision/torralba/u/$USER/tools/cloudcli
cd /data/vision/torralba/u/$USER/tools/cloudcli
cp local.env.example local.env          # edit NODE_HOME; set PUBLIC_PORT=8443
PATH="$(. ./local.env; echo $NODE_HOME)/bin:$PATH" npm ci

# 3. Voice env (the Whisper model downloads to $HF_HOME on first start)
uv venv --python 3.11 voice/.venv
uv pip install --python voice/.venv/bin/python faster-whisper fastapi uvicorn python-multipart

# 4. Start everything (also generates STT_API_KEY into local.env)
./up.sh
```

## First visit from a new device

1. Open `https://<host>.csail.mit.edu:8443`. The browser warns about the certificate: check that its
   SHA-256 fingerprint matches the one printed in the `gate` tmux window, then accept.
2. The page shows a code like `QFZ3-TN48`. On the CSAIL host: `./devices approve QFZ3-TN48 phone`.
3. The page refreshes into CloudCLI. The very first time, create your account (single user, then sign-up
   closes; pick a **long** password, it only enforces 6+ chars). Afterwards, just log in.

Whether port 8443 is reachable from off campus depends on CSAIL's network, not on this repo.

## Voice

The mic button in the chat box records in the browser and sends audio to the local Whisper server.
It appears only when the `voice` window is running and `STT_API_KEY` is set. About 6 s for 10 s of speech
with `large-v3-turbo` on 16 threads; set `STT_MODEL=small.en` in `local.env` for faster, rougher results.
Browsers allow the mic only over HTTPS (or `localhost`). Text-to-speech is not set up.

## Operations

| Task | Command |
|---|---|
| Start / restart all | `./up.sh` |
| Stop | `tmux kill-session -t cloudcli` |
| Logs | `tmux attach -t cloudcli`, switch windows with `Ctrl-b n` (detach: `Ctrl-b d`) |
| Health check | `curl -s --unix-socket /tmp/cloudcli-$USER/sock http://x/api/auth/status` |
| Approve a device | `./devices list`, then `./devices approve <CODE> phone` |
| Revoke a device | `./devices revoke phone` |
| Update CloudCLI | edit version in `package.json`, `npm install`, `./up.sh`, commit the lockfile |
| Reset account (logs everyone out) | stop, `rm ~/.cloudcli/auth.db`, `./up.sh`, create the account again |
| New TLS cert | `rm -r ~/.cloudcli/tls`, `./up.sh` (devices will see a new fingerprint) |

The tmux session doesn't survive a host reboot; run `./up.sh` again. `/tmp` may be cleaned, but the
scripts recreate the socket directory on each start.

## Troubleshooting

- **Page hangs / connection refused**: is the `gate` window running and listening (`ss -ltn | grep 8443`)?
  Off campus, the port may simply be blocked by the network.
- **Gate page keeps showing a code**: approve the *current* code (`./devices list`); codes expire after 30 min.
- **No mic button**: the `voice` window must be running and `STT_API_KEY` set in `local.env`; reload the page.
- **Things break after ~a day**: `~/.claude` and `~/.cloudcli` are on AFS. Long-running tmux processes can lose
  AFS tokens when your Kerberos ticket expires. SSH in again (fresh ticket) and run `./up.sh`.
- **`EADDRINUSE` / socket errors at start**: `SOCK_DIR` must be on local disk (`/tmp`), not AFS/NFS.
