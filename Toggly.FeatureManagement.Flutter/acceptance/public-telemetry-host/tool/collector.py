"""Credential-free signed definitions and telemetry loopback for OPS-1387.

Run: python3 tool/collector.py --port 8765 --output /private/tmp/ops1387-packets.jsonl
The P-256 signing key is ephemeral and never written into the candidate.
"""
import argparse
import base64
import gzip
import hashlib
import json
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def compact(value):
    return json.dumps(value, separators=(",", ":")).encode()


def raw_signature(der):
    if der[0] != 0x30:
        raise ValueError("Expected ASN.1 sequence")
    index = 2
    if der[1] & 0x80:
        count = der[1] & 0x7f
        index = 2 + count
    values = []
    for _ in range(2):
        if der[index] != 0x02:
            raise ValueError("Expected ASN.1 integer")
        length = der[index + 1]
        values.append(int.from_bytes(der[index + 2:index + 2 + length], "big"))
        index += 2 + length
    return b"".join(value.to_bytes(32, "big") for value in values)


def signed_fixture(key_path, kid, defs, timestamp):
    raw_defs = compact(defs)
    first_hash = hashlib.sha256(raw_defs + b"|" + str(timestamp).encode()).digest()
    signature_der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path)],
        input=first_hash, capture_output=True, check=True).stdout
    return b'{"defs":' + raw_defs + b',"signature":"' + base64.b64encode(raw_signature(signature_der)) + (
        b'","timestamp":%d,"kid":"%s"}' % (timestamp, kid.encode()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--output", default="/private/tmp/ops1387-packets.jsonl")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="ops1387-signing-") as directory:
        key_path = Path(directory) / "fixture.pem"
        subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey",
                        "-noout", "-out", str(key_path)], check=True, capture_output=True)
        public_der = subprocess.run(["openssl", "pkey", "-in", str(key_path),
                                     "-pubout", "-outform", "DER"], check=True,
                                    capture_output=True).stdout
        point = public_der[-65:]
        if len(point) != 65 or point[0] != 4:
            raise ValueError("Expected uncompressed P-256 point")
        x, y = point[1:33], point[33:65]
        kid = hashlib.sha1(x + y).hexdigest().upper() + "ES256"
        b64url = lambda raw: base64.urlsafe_b64encode(raw).decode().rstrip("=")
        jwks = compact({"keys": [{"kty": "EC", "use": "sig", "kid": kid,
                                   "crv": "P-256", "alg": "ES256",
                                   "x": b64url(x), "y": b64url(y)}]})
        timestamp = int(time.time())
        flags = signed_fixture(key_path, kid, {"checkout": True, "disabled": False}, timestamp)
        variants = signed_fixture(key_path, kid, {"checkout": {
            "enabled": True, "variant": "blue", "configurationValue": 7}}, timestamp)

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith("/.well-known/jwks"):
                    body = jwks
                elif "evaluated-variants-signed" in self.path:
                    body = variants
                elif "evaluated-signed" in self.path:
                    body = flags
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                if self.path != "/api/frontend/telemetry":
                    self.send_error(404)
                    return
                raw = self.rfile.read(int(self.headers["Content-Length"]))
                body = gzip.decompress(raw) if self.headers.get("Content-Encoding") == "gzip" else raw
                packet = json.loads(body)
                record = {"path": self.path,
                          "encoding": self.headers.get("Content-Encoding", "plain"),
                          "origin": self.headers.get("Origin"),
                          "cookie": self.headers.get("Cookie"),
                          "authorization": self.headers.get("Authorization"),
                          "packet": packet}
                with open(args.output, "a", encoding="utf-8") as stream:
                    stream.write(json.dumps(record, separators=(",", ":")) + "\n")
                self.send_response(202)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":1}')

        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
        print(f"Collector listening on http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
