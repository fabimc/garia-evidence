"""Range-aware throttled HTTP server: /big.bin is 1 GiB of zeros served slowly; anything else is 404."""
import sys, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

SIZE = 1 << 30
CHUNK = 16 * 1024
DELAY = 0.05


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%.3f %s\n" % (time.time(), fmt % args))

    def _head(self):
        if self.path != "/big.bin":
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        start, end = 0, SIZE - 1
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else 0
            end = int(b) if b else SIZE - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{SIZE}")
        else:
            self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        return start, end

    def do_HEAD(self):
        self._head()

    def do_GET(self):
        r = self._head()
        if r is None:
            return
        left = r[1] - r[0] + 1
        buf = b"\0" * CHUNK
        try:
            while left > 0:
                n = min(CHUNK, left)
                self.wfile.write(buf[:n])
                left -= n
                time.sleep(DELAY)
        except (BrokenPipeError, ConnectionResetError):
            pass


ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
