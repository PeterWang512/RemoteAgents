# CloudCLI over SSH on CSAIL

A browser UI for the Claude Code sessions running on a CSAIL machine, opened from your laptop.
It stands in for `claude /remote-control`, which our organization disables.

It uses [CloudCLI](https://github.com/siteboon/claudecodeui) (`@cloudcli-ai/cloudcli`), served on a
**private Unix socket** and reached **only through your normal SSH login** (jump host + Duo + Kerberos).
By default nothing is exposed to the internet. An optional public HTTPS path (see
[Public access](#public-access-optional)) goes through a device-approval gate.

Extras: **voice input** (mic button, transcribed locally by Whisper on CPU) and a
**device-approval gate** (new browsers must be approved from a CSAIL shell).

```
laptop browser ── http://localhost:3001
      │
      │  ssh -L 3001:/tmp/cloudcli-<you>/sock   (laptop/tunnel.sh)
      ▼
jump.csail.mit.edu   ← Duo 2FA + Kerberos
      │  ProxyJump
      ▼
torralba-3090-4 ── /tmp/cloudcli-<you>/sock   (dir 0700, socket 0600)
                      └── CloudCLI (start.sh) ── Claude Code sessions in ~/.claude
                            └── mic audio ──> Whisper STT, 127.0.0.1:8765 (API key)

optional public path:
phone ──https:8443 (self-signed)──> device gate ──> sock
```

## Security model

You pass three checks to reach the UI:

1. **SSH login**: Duo at the jump host, Kerberos for your own account.
2. **Unix socket permissions**: CloudCLI does not listen on any TCP port. A port on `127.0.0.1` would be
   reachable by *every* user on a shared host. `unix-listen.cjs` moves it to a socket only your user can open.
3. **Device gate** (public HTTPS path only): unknown browsers get a code and nothing else until you run
   `./devices approve <CODE>` on the CSAIL host. Only cookie hashes are stored (`~/.cloudcli/devices.json`).
4. **CloudCLI login**: single user account, bcrypt-hashed password, 7-day signed session tokens.
   Data lives in `~/.cloudcli/` (on AFS, other users get lookup-only, no read).

The STT server listens on 127.0.0.1 (reachable by other local users), so it requires a random
API key (`STT_API_KEY` in `local.env`, mode 600). Audio never leaves the host.

## Files

| File | Where it runs | What it does |
|---|---|---|
| `up.sh` | CSAIL host | Starts everything in tmux session `cloudcli` (windows: cloudcli, voice, gate) |
| `start.sh` | CSAIL host | Starts CloudCLI on the private socket (with voice config) |
| `env.sh` | CSAIL host | Shared settings sourced by the scripts |
| `voice/stt_server.py`, `voice/start.sh` | CSAIL host | OpenAI-compatible Whisper STT on CPU |
| `gate.cjs`, `gate.sh` | CSAIL host | Device-approval gate (HTTP + WebSocket proxy) |
| `devices` | CSAIL host | `list` / `approve <CODE> [name]` / `revoke <name>` |
| `unix-listen.cjs` | CSAIL host | Node preload that redirects CloudCLI's TCP listen to the socket |
| `local.env.example` | CSAIL host | Per-machine settings (`NODE_HOME`, `SOCK_DIR`); copy to `local.env` |
| `package.json` / `package-lock.json` | CSAIL host | Pins the CloudCLI version |
| `laptop/tunnel.sh` | laptop | Self-reconnecting SSH forward to the socket |
| `laptop/ssh_config.example` | laptop | Jump host + Kerberos SSH config |

## Setup: CSAIL host (once)

Run Claude Code here as you already do (`claude` must work and be logged in; CloudCLI reuses that login).

```bash
# 1. Node >= 22 on NFS (skip if `node --version` already says v22+)
micromamba create -p /data/vision/torralba/u/$USER/envs/node22 -c conda-forge nodejs=22 -y

# 2. Get this repo and install pinned deps
git clone <this-repo-url> /data/vision/torralba/u/$USER/tools/cloudcli
cd /data/vision/torralba/u/$USER/tools/cloudcli
cp local.env.example local.env          # then edit NODE_HOME
PATH="$(. ./local.env; echo $NODE_HOME)/bin:$PATH" npm ci

# 3. Voice env (Whisper model downloads to $HF_HOME on first start)
uv venv --python 3.11 voice/.venv
uv pip install --python voice/.venv/bin/python faster-whisper fastapi uvicorn python-multipart

# 4. Start everything in tmux (also generates STT_API_KEY into local.env)
./up.sh

# 5. Check (expect {"needsSetup":true,...} first time, then needsSetup:false)
curl -s --unix-socket /tmp/cloudcli-$USER/sock http://localhost/api/auth/status
```

## Setup: laptop (once)

1. Kerberos + SSH config: install MIT Kerberos (`brew install krb5` on macOS), set up `/etc/krb5.conf` for
   `CSAIL.MIT.EDU`, then append `laptop/ssh_config.example` to `~/.ssh/config` (replace `<you>`).
   Check: `kinit <you>@CSAIL.MIT.EDU && ssh torralba-3090-4 hostname`.
2. Copy `laptop/tunnel.sh` to the laptop.

## Daily use

```bash
kinit <you>@CSAIL.MIT.EDU            # once per ~10h
./laptop/tunnel.sh torralba-3090-4 <you>
# open http://localhost:3001
```

**First visit:** CloudCLI shows a setup screen. Create your username and a **long** password right away
(it only enforces 6+ chars). After that, sign-up is closed: it is a single-user app.

## Operations (on the CSAIL host)

| Task | Command |
|---|---|
| Is it running? | `tmux list-windows -t cloudcli` and the `curl --unix-socket` check above |
| Logs | `tmux attach -t cloudcli`, switch windows with `Ctrl-b n` (detach: `Ctrl-b d`) |
| Start / restart all | `./up.sh` |
| Stop | `tmux kill-session -t cloudcli` |
| Approve a new device | `./devices list`, then `./devices approve <CODE> phone` |
| Revoke a device | `./devices revoke phone` |
| Update CloudCLI | edit version in `package.json`, `npm install`, restart, commit the lockfile |
| Reset account / log everyone out | stop, `rm ~/.cloudcli/auth.db`, start, create the account again |

The tmux session does not survive a host reboot. After one, run the start command again.
`/tmp` may be cleaned, but `start.sh` recreates the socket directory on each start.

## Voice

The mic button in the chat box records in the browser and sends audio to the local Whisper server.
First request after a start loads the model (~seconds); afterwards ~6 s for 10 s of speech with
`large-v3-turbo` on 16 threads. For faster/rougher results set `STT_MODEL=small.en` in `local.env`.
Browsers allow the mic only on HTTPS or `localhost`, so it works over the SSH tunnel and the public
HTTPS path, but not on plain `http://<some-ip>`. Text-to-speech is not set up.

## Public access (optional)

Set `PUBLIC_PORT=8443` in `local.env` and run `./up.sh`. The **gate** (never CloudCLI itself) then also
listens on `https://0.0.0.0:8443` with a self-signed certificate (created once in `~/.cloudcli/tls/`,
fingerprint printed in the `gate` tmux window). Only HTTPS is offered: plain HTTP would leak your
password and session cookie, and browsers block the mic without HTTPS.

First time on a new device:
1. Open `https://<host>.csail.mit.edu:8443`. Accept the certificate warning *after* checking that the
   fingerprint matches the one in the `gate` window.
2. The page shows a code. On the CSAIL host: `./devices approve <CODE> phone`.
3. The page refreshes into CloudCLI; log in with your password.

Whether this is reachable from off campus depends on CSAIL's network, not on this repo.

## Phone (without public access)

There's no good direct path. Phone SSH apps generally can't do Kerberos + ProxyJump + Unix-socket
forwarding, and phones kill background SSH. The compliant option is to relay through your laptop:
keep `tunnel.sh` running there and reach the laptop from the phone over Tailscale installed on
**laptop and phone only** (never on the CSAIL host).

## Troubleshooting

- **`tunnel.sh` loops "tunnel dropped"**: Kerberos ticket expired → `kinit` again; or CloudCLI isn't running → check the socket.
- **Browser says connection refused**: tunnel not running, or something else already uses local port 3001 → `./tunnel.sh torralba-3090-4 <you> 3002`.
- **`Permission denied` opening the socket**: you're connecting as a different user than the one who started CloudCLI (expected; that's the point).
- **No mic button**: the `voice` tmux window must be running and `STT_API_KEY` set in `local.env`; reload the page.
- **Gate page loops on the approval code**: approve the *current* code (`./devices list`); codes expire after 30 min.
- **Things break after ~a day**: `~/.claude` and `~/.cloudcli` are on AFS; long-running tmux processes can lose AFS
  tokens when your Kerberos ticket expires. SSH in again (fresh ticket) and run `./up.sh`.
- **`Error: listen EADDRINUSE` / socket errors at start**: `SOCK_DIR` is on AFS/NFS. It must be local disk (`/tmp`).
