#!/usr/bin/env node
// Device-approval gate in front of CloudCLI.
//
// Every browser gets a random device cookie. Unknown devices see a page with a
// short code and get NOTHING else (not even CloudCLI's login page) until you
// approve that code from a shell on the CSAIL host:
//
//   ./devices list                 pending + approved devices
//   ./devices approve <CODE> [name]
//   ./devices revoke <name|CODE>
//
// Approved devices are proxied (HTTP + WebSocket) to CloudCLI's private socket,
// where CloudCLI's own username/password login still applies.
//
// Server mode:  node gate.cjs serve   (env: GATE_SOCK, UPSTREAM_SOCK, DEVICES_FILE)
// Only stores sha256(cookie), so a leaked devices file can't be replayed.
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEVICES_FILE = process.env.DEVICES_FILE || path.join(process.env.HOME, '.cloudcli', 'devices.json');
const COOKIE = 'cc_device';
const PENDING_MAX = 30;
const PENDING_TTL_MS = 30 * 60 * 1000;

// ---------- state file ----------
function load() {
  try {
    const s = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
    return { approved: s.approved || [], pending: s.pending || [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { approved: [], pending: [] };
    throw e; // unreadable/corrupt -> caller fails closed
  }
}
function save(state) {
  const tmp = `${DEVICES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DEVICES_FILE);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const codeOf = (hash) => {
  const n = BigInt('0x' + hash.slice(0, 16));
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  let s = '', x = n;
  for (let i = 0; i < 8; i++) { s += A[Number(x % 31n)]; x /= 31n; }
  return s.slice(0, 4) + '-' + s.slice(4);
};

// ---------- admin CLI ----------
function admin(argv) {
  const [cmd, arg, name] = argv;
  const st = load();
  const now = Date.now();
  st.pending = st.pending.filter((p) => now - p.seen < PENDING_TTL_MS);
  if (cmd === 'list' || !cmd) {
    console.log('APPROVED');
    for (const a of st.approved) console.log(`  ${a.name.padEnd(16)} ${a.code}  since ${new Date(a.approved).toLocaleString()}  ${a.ua.slice(0, 70)}`);
    console.log('PENDING (expire after 30 min)');
    for (const p of st.pending) console.log(`  ${p.code}  ${new Date(p.seen).toLocaleString()}  ip=${p.ip}  ${p.ua.slice(0, 70)}`);
    return;
  }
  if (cmd === 'approve') {
    const want = String(arg || '').toUpperCase();
    const p = st.pending.find((x) => x.code === want);
    if (!p) { console.error(`no pending device with code ${want} (run: ./devices list)`); process.exit(1); }
    st.pending = st.pending.filter((x) => x !== p);
    st.approved.push({ hash: p.hash, code: p.code, name: name || p.code, ua: p.ua, approved: now });
    save(st);
    console.log(`approved ${p.code} as "${name || p.code}"`);
    return;
  }
  if (cmd === 'revoke') {
    const before = st.approved.length;
    st.approved = st.approved.filter((a) => a.name !== arg && a.code !== String(arg).toUpperCase());
    save(st);
    console.log(`revoked ${before - st.approved.length} device(s)`);
    return;
  }
  console.error('usage: devices [list | approve <CODE> [name] | revoke <name|CODE>]');
  process.exit(2);
}

// ---------- server ----------
function serve() {
  const GATE_SOCK = process.env.GATE_SOCK;
  const UPSTREAM = process.env.UPSTREAM_SOCK;
  if (!GATE_SOCK || !UPSTREAM) throw new Error('GATE_SOCK and UPSTREAM_SOCK required');

  const cookieOf = (req) => {
    const m = /(?:^|;\s*)cc_device=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  const approved = (token) => {
    if (!token) return false;
    const h = sha(token);
    try { return load().approved.some((a) => a.hash === h); } catch { return false; } // fail closed
  };
  const notePending = (token, req) => {
    const h = sha(token);
    let st;
    try { st = load(); } catch { return codeOf(h); }
    const now = Date.now();
    st.pending = st.pending.filter((p) => now - p.seen < PENDING_TTL_MS && p.hash !== h);
    st.pending.push({ hash: h, code: codeOf(h), seen: now,
      ip: String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?'),
      ua: String(req.headers['user-agent'] || '?').slice(0, 200) });
    st.pending = st.pending.slice(-PENDING_MAX);
    try { save(st); } catch {}
    return codeOf(h);
  };

  const pendingPage = (code) => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<meta http-equiv=refresh content=5><title>Device approval</title>
<body style="font:16px system-ui;max-width:28em;margin:3em auto;padding:0 16px;color:#222;background:#fafafa">
<h2>This device isn't approved yet</h2>
<p>On the CSAIL host, run:</p>
<pre style="font-size:1.3em;background:#eee;padding:.6em;border-radius:6px">./devices approve ${code} &lt;name&gt;</pre>
<p>This page refreshes by itself.</p></body>`;

  const server = http.createServer((req, res) => {
    let token = cookieOf(req);
    if (approved(token)) {
      const up = http.request({ socketPath: UPSTREAM, path: req.url, method: req.method, headers: req.headers }, (ur) => {
        res.writeHead(ur.statusCode, ur.rawHeaders);
        ur.pipe(res);
      });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('CloudCLI is not running'); });
      req.pipe(up);
      return;
    }
    if (!token) token = crypto.randomBytes(32).toString('hex');
    const code = notePending(token, req);
    res.writeHead(403, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': `${COOKIE}=${token}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`,
    });
    res.end(pendingPage(code));
  });

  server.on('upgrade', (req, sock, head) => {
    if (!approved(cookieOf(req))) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = net.connect(UPSTREAM, () => {
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      up.write(raw + '\r\n');
      if (head && head.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    const kill = () => { sock.destroy(); up.destroy(); };
    up.on('error', kill); sock.on('error', kill);
  });

  try { fs.unlinkSync(GATE_SOCK); } catch {}
  server.listen(GATE_SOCK, () => {
    fs.chmodSync(GATE_SOCK, 0o600);
    console.log(`gate: ${GATE_SOCK} -> ${UPSTREAM}  (devices: ${DEVICES_FILE})`);
  });
}

if (process.argv[2] === 'serve') serve();
else admin(process.argv.slice(2));
