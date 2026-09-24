"""Loopback-only, credential-free native HTTP witness for the public Apple host."""
import argparse
import gzip
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFINITIONS = {
    "On": True,
    "Off": False,
    "OrderGate": {
        "requirement": "all",
        "rules": [{"property": "Color", "op": "eq", "value": "blue"}],
    },
}
VARIANTS = {
    "On": {"enabled": True},
    "Off": {"enabled": False},
    "Checkout": {
        "enabled": True,
        "variant": "Treatment",
        "configurationValue": {"color": "blue"},
    },
}


def serve(mode: str, output: Path) -> None:
    count = 0

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def record(self, value):
            with output.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(value, sort_keys=True) + "\n")

        def do_GET(self):
            if self.path.startswith("/base/evaluated-variants-signed/"):
                body = VARIANTS
            elif self.path.startswith("/base/evaluated-signed/"):
                body = DEFINITIONS
            else:
                self.send_error(404)
                return
            self.record({"method": "GET", "path": self.path})
            encoded = json.dumps(body, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self):
            nonlocal count
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            encoding = self.headers.get("Content-Encoding")
            if encoding == "gzip":
                raw = gzip.decompress(raw)
            body = json.loads(raw)
            count += 1
            status = 202
            if count == 1 and mode == "retry429":
                status = 429
            elif count == 1 and mode == "retry503":
                status = 503
            elif count == 1 and mode == "ambiguous":
                status = "dropped"
            self.record({
                "method": "POST", "path": self.path, "status": status,
                "encoding": encoding, "headers": {
                    key.lower(): self.headers.get(key)
                    for key in ("Origin", "Authorization", "Cookie")
                }, "body": body,
            })
            if status == "dropped":
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

    output.write_text("", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["normal", "retry429", "retry503", "ambiguous"], default="normal")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    serve(args.mode, args.output)
