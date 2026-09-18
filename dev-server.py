#!/usr/bin/env python3
"""Local dev server for the Zero Calculator PWA.

Identical to `python3 -m http.server`, except every response carries
Cache-Control: no-store — so the browser always refetches the latest files
while this app is under active development, instead of silently serving a
stale cached copy that a normal reload doesn't bypass.
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8934
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    handler_class = functools.partial(NoCacheHandler, directory=DIRECTORY)
    # Single-threaded on purpose: this folder lives under iCloud Desktop sync,
    # and concurrent threads reading the same file here can hit a macOS file-
    # locking deadlock (OSError 11) that silently truncates the response body
    # (browser sees it as ERR_CONTENT_LENGTH_MISMATCH). Sequential handling
    # avoids the race entirely — plenty fast for local single-user dev use.
    with http.server.HTTPServer(("127.0.0.1", PORT), handler_class) as httpd:
        print(f"Serving {DIRECTORY} at http://127.0.0.1:{PORT} (no-cache)", flush=True)
        httpd.serve_forever()
