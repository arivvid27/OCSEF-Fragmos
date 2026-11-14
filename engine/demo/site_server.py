"""Serves demo/site/ on 127.0.0.1:8788, the only place the demo agent's web_fetch reaches."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE = Path(__file__).resolve().parent / "site"

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8788), partial(SimpleHTTPRequestHandler, directory=str(SITE)))
    print(f"serving {SITE} on http://127.0.0.1:8788", flush=True)
    server.serve_forever()
