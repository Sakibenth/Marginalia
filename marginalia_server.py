"""
Marginalia local server.

Serves this folder at http://localhost:8000 (so YouTube embeds work) and adds a
small /proxy endpoint that fetches web pages for Marginalia's Reader view
(a browser page cannot read another site's content directly).

Safety:
  * listens on 127.0.0.1 only (not reachable from other computers)
  * /proxy requires the X-Marginalia header, so other websites open in your
    browser cannot use it
  * only http/https, public addresses only (no localhost / LAN), 15 s timeout,
    8 MB size limit, checked on every redirect

Usage:  python marginalia_server.py [port]
"""
import http.server
import ipaddress
import os
import socket
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8000
MAX_BYTES = 8 * 1024 * 1024
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def is_public_host(host):
    """True only if every address the host resolves to is a public IP."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or
                ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False
    return True


def check_url(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("Only http:// and https:// links are supported")
    if not is_public_host(parts.hostname):
        raise ValueError("That address is not a public website")


class SafeRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(SafeRedirects)


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write("  " + (fmt % args) + "\n")

    def end_headers(self):
        # always serve fresh copies of the app while you iterate on it
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urllib.parse.urlsplit(self.path).path
        if path == "/proxy-ping":
            return self._send(200, b"ok", "text/plain")
        if path == "/proxy":
            return self._proxy()
        return super().do_GET()

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self):
        if self.headers.get("X-Marginalia") != "1":
            return self._send(403, b"Forbidden", "text/plain")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
        url = (query.get("url") or [""])[0].strip()
        try:
            check_url(url)
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with OPENER.open(req, timeout=15) as resp:
                data = resp.read(MAX_BYTES + 1)
                if len(data) > MAX_BYTES:
                    raise ValueError("That page is too large (over 8 MB)")
                ctype = resp.headers.get("Content-Type", "text/html; charset=utf-8")
                final = resp.geturl()
            self._send(200, data, ctype, {"X-Final-URL": urllib.parse.quote(final, safe=":/?&=#%+~@!$,;")})
        except urllib.error.HTTPError as e:
            self._send(502, ("The site answered with error %d" % e.code).encode(), "text/plain")
        except Exception as e:  # noqa: BLE001 - report any failure to the app
            self._send(502, ("Could not load the page: %s" % e).encode()[:500], "text/plain")


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        print("Port %d is already in use - Marginalia may already be running." % PORT)
        print("Open http://localhost:%d in your browser, or close the other server window." % PORT)
        input("Press Enter to close...")
        sys.exit(1)
    print("Marginalia server running at http://localhost:%d  (Reader view enabled)" % PORT)
    print("Keep this window open while you work. Close it to stop the server.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
