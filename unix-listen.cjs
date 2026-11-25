// Preloaded via NODE_OPTIONS by start.sh.
//
// CloudCLI only accepts a numeric TCP port, and a TCP port on 127.0.0.1 is
// reachable by every user on a shared host. This patch redirects the server's
// listen(SERVER_PORT, ...) to a Unix socket at $CLOUDCLI_SOCK and makes it
// owner-only (0600), so only your own user (and your SSH forwards) can connect.
const net = require('net');
const fs = require('fs');

const SOCK = process.env.CLOUDCLI_SOCK;
const PORT = Number(process.env.SERVER_PORT || 3001);
const origListen = net.Server.prototype.listen;

net.Server.prototype.listen = function (...args) {
  if (SOCK && Number(args[0]) === PORT) {
    const cb = args.find((a) => typeof a === 'function');
    try { fs.unlinkSync(SOCK); } catch {}            // remove a stale socket from a previous run
    this.once('listening', () => fs.chmodSync(SOCK, 0o600));
    return cb ? origListen.call(this, SOCK, cb) : origListen.call(this, SOCK);
  }
  return origListen.apply(this, args);
};
