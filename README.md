# CloudCLI over SSH on CSAIL

A browser UI for the Claude Code sessions running on a CSAIL machine, opened from your laptop.
It stands in for `claude /remote-control`, which our organization disables.

It uses [CloudCLI](https://github.com/siteboon/claudecodeui) (`@cloudcli-ai/cloudcli`), served on a
**private Unix socket** and reached **only through your normal SSH login** (jump host + Duo + Kerberos).
Nothing is exposed to the internet and no CSAIL network control is bypassed.

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
```

## Security model

You pass three checks to reach the UI:

1. **SSH login**: Duo at the jump host, Kerberos for your own account.
2. **Unix socket permissions**: CloudCLI does not listen on any TCP port. A port on `127.0.0.1` would be
   reachable by *every* user on a shared host. `unix-listen.cjs` moves it to a socket only your user can open.
3. **CloudCLI login**: single user account, bcrypt-hashed password, 7-day signed session tokens.
   Data lives in `~/.cloudcli/` (on AFS, other users get lookup-only, no read).

**Don't** expose this with `cloudflared`, ngrok, Tailscale, `code tunnel`, etc. *on the CSAIL host*.
That bypasses CSAIL network controls (same reason TIG bans `code tunnel`) and puts a
"run shell as you" web app on the internet.

## Files

| File | Where it runs | What it does |
|---|---|---|
| `start.sh` | CSAIL host | Starts CloudCLI on the private socket |
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

# 3. Start it in tmux
tmux new -d -s cloudcli ./start.sh

# 4. Check (expect {"needsSetup":true,...} first time, then needsSetup:false)
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
| Is it running? | `tmux ls \| grep cloudcli` and the `curl --unix-socket` check above |
| Logs | `tmux attach -t cloudcli` (detach: `Ctrl-b d`) |
| Stop | `tmux kill-session -t cloudcli` |
| Restart | stop, then `tmux new -d -s cloudcli ./start.sh` |
| Update CloudCLI | edit version in `package.json`, `npm install`, restart, commit the lockfile |
| Reset account / log everyone out | stop, `rm ~/.cloudcli/auth.db`, start, create the account again |

The tmux session does not survive a host reboot. After one, run the start command again.
`/tmp` may be cleaned, but `start.sh` recreates the socket directory on each start.

## Phone

There's no good direct path. Phone SSH apps generally can't do Kerberos + ProxyJump + Unix-socket
forwarding, and phones kill background SSH. The compliant option is to relay through your laptop:
keep `tunnel.sh` running there and reach the laptop from the phone over Tailscale installed on
**laptop and phone only** (never on the CSAIL host).

## Troubleshooting

- **`tunnel.sh` loops "tunnel dropped"**: Kerberos ticket expired → `kinit` again; or CloudCLI isn't running → check the socket.
- **Browser says connection refused**: tunnel not running, or something else already uses local port 3001 → `./tunnel.sh torralba-3090-4 <you> 3002`.
- **`Permission denied` opening the socket**: you're connecting as a different user than the one who started CloudCLI (expected; that's the point).
- **`Error: listen EADDRINUSE` / socket errors at start**: `SOCK_DIR` is on AFS/NFS. It must be local disk (`/tmp`).
