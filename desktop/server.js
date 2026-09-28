'use strict';
/**
 * Marginalia's built-in local server (replaces marginalia_server.py in the desktop app).
 *  - serves the app from ./app over http://127.0.0.1:<port> (YouTube needs a real http origin)
 *  - /proxy fetches web pages for Reader view (a page can't read other sites directly)
 * Safety: loopback only; /proxy requires the X-Marginalia header; http/https only;
 * public addresses only (checked on every redirect); 15 s timeout; 8 MB limit.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 8 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};

function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;           // this-net, private, loopback, multicast/reserved
    if (a === 169 && b === 254) return false;                                // link-local
    if (a === 172 && b >= 16 && b <= 31) return false;                       // private
    if (a === 192 && b === 168) return false;                                // private
    if (a === 100 && b >= 64 && b <= 127) return false;                      // carrier-grade NAT
    if (a === 192 && b === 0) return false;                                  // IETF special
    if (a === 198 && (b === 18 || b === 19)) return false;                   // benchmarking
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    if (v === '::' || v === '::1') return false;
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || /^ff/.test(v)) return false; // unique-local, link-local, multicast
    return true;
  }
  return false;
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid web address'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http:// and https:// links are supported');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || !addrs.every(a => isPublicIp(a.address))) throw new Error('That address is not a public website');
  return u.href;
}

async function fetchPage(rawUrl, fetchImpl) {
  let url = await checkUrl(rawUrl);
  for (let hop = 0; hop < 6; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetchImpl(url, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
      });
    } catch (e) { clearTimeout(timer); throw new Error(e.name === 'AbortError' ? 'The site took too long to answer' : 'Could not reach the site'); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = await checkUrl(new URL(res.headers.get('location'), url).href);   // re-check every redirect
      continue;
    }
    if (!res.ok) { clearTimeout(timer); throw new Error('The site answered with error ' + res.status); }
    const chunks = []; let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { clearTimeout(timer); ctrl.abort(); throw new Error('That page is too large (over 8 MB)'); }
      chunks.push(Buffer.from(value));
    }
    clearTimeout(timer);
    return { body: Buffer.concat(chunks), type: res.headers.get('content-type') || 'text/html; charset=utf-8', finalUrl: url };
  }
  throw new Error('Too many redirects');
}

function startServer({ root, ports = [38417], fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  const rootDir = path.resolve(root);
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type, extra) => {
      res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {}));
      res.end(body);
    };
    let u;
    try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return send(400, 'Bad request', 'text/plain'); }
    if (u.pathname === '/proxy-ping') return send(200, 'ok', 'text/plain');
    if (u.pathname === '/proxy') {
      if (req.headers['x-marginalia'] !== '1') return send(403, 'Forbidden', 'text/plain');
      try {
        const page = await fetchPage(u.searchParams.get('url') || '', fetchImpl);
        return send(200, page.body, page.type, { 'X-Final-URL': encodeURI(page.finalUrl) });
      } catch (e) { return send(502, 'Could not load the page: ' + e.message, 'text/plain; charset=utf-8'); }
    }
    // static files (no directory traversal)
    let rel;
    try { rel = decodeURIComponent(u.pathname); } catch { return send(400, 'Bad request', 'text/plain'); }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.resolve(rootDir, '.' + rel);
    if (!file.startsWith(rootDir + path.sep)) return send(403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) { log('server: could not serve', rel, '-', err.code || err.message); return send(404, 'Not found', 'text/plain'); }
      send(200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  });
  server.on('clientError', (e, sock) => { try { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) { /* ignore */ } });
  // Try each fixed port in turn (a port can be busy, or reserved by Windows -> EACCES), then any free port.
  const candidates = [...ports, 0];
  return new Promise((resolve, reject) => {
    let i = 0;
    const attempt = () => {
      const p = candidates[i];
      const onError = err => {
        log('server: port', p, 'unavailable:', err.code || err.message);
        if (++i < candidates.length) attempt(); else reject(err);
      };
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const actual = server.address().port;
        resolve({ server, port: actual, preferred: actual === ports[0] });
      });
    };
    attempt();
  });
}

/**
 * A tiny fetch()-compatible wrapper around Electron's net.request, so page fetches go through
 * Chromium's network stack (honours Windows proxy settings and the Windows certificate store).
 * Redirects are surfaced (not followed) so fetchPage can re-check every hop.
 */
function makeElectronFetch(net) {
  return (url, opts = {}) => new Promise((resolve, reject) => {
    const req = net.request({ url, method: 'GET', redirect: 'manual', useSessionCookies: false });
    for (const [k, v] of Object.entries(opts.headers || {})) req.setHeader(k, v);
    let settled = false;
    const fail = e => { if (!settled) { settled = true; reject(e); } };
    if (opts.signal) opts.signal.addEventListener('abort', () => {
      try { req.abort(); } catch (_) { /* already finished */ }
      const e = new Error('aborted'); e.name = 'AbortError'; fail(e);
    });
    req.on('redirect', (status, method, redirectUrl) => {
      settled = true;
      try { req.abort(); } catch (_) { /* ignore */ }
      resolve({ status, ok: false, headers: { get: k => (k.toLowerCase() === 'location' ? redirectUrl : null) }, body: null });
    });
    req.on('response', res => {
      settled = true;
      const queue = []; let ended = false, waiting = null, error = null;
      const flush = () => {
        if (!waiting) return;
        const w = waiting;
        if (error) { waiting = null; w.reject(error); }
        else if (queue.length) { waiting = null; w.resolve({ done: false, value: queue.shift() }); }
        else if (ended) { waiting = null; w.resolve({ done: true }); }
      };
      res.on('data', c => { queue.push(c); flush(); });
      res.on('end', () => { ended = true; flush(); });
      res.on('error', e => { error = e; flush(); });
      const get = k => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v.join(', ') : (v == null ? null : v); };
      resolve({
        status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: { get },
        body: { getReader: () => ({ read: () => new Promise((r, j) => { waiting = { resolve: r, reject: j }; flush(); }) }) },
      });
    });
    req.on('error', fail);
    req.end();
  });
}

module.exports = { startServer, fetchPage, checkUrl, isPublicIp, makeElectronFetch };
