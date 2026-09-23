"""Ephemeral signed definitions and credential-free loopback telemetry capture."""
import argparse
import base64
import gzip
import hashlib
import json
import socket
import subprocess
import tempfile
import threading
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
        index = 2 + (der[1] & 0x7f)
    values = []
    for _ in range(2):
        if der[index] != 2:
            raise ValueError("Expected ASN.1 integer")
        length = der[index + 1]
        values.append(int.from_bytes(der[index + 2:index + 2 + length], "big"))
        index += 2 + length
    return b"".join(value.to_bytes(32, "big") for value in values)


def signed_fixture(key_path, kid, defs):
    raw_defs = compact(defs)
    timestamp = int(time.time())
    first_hash = hashlib.sha256(raw_defs + b"|" + str(timestamp).encode()).digest()
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path)],
        input=first_hash, capture_output=True, check=True
    ).stdout
    return b'{"defs":' + raw_defs + b',"timestamp":' + str(timestamp).encode() + (
        b',"signature":"' + base64.b64encode(raw_signature(der)) +
        b'","kid":"' + kid.encode() + b'"}'
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--output", default="/private/tmp/ops1388-native-packets.jsonl")
    parser.add_argument("--ambiguous-first", action="store_true",
                        help="Read and record the first POST, then close without an HTTP response")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="ops1388-signing-") as directory:
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
        flags = signed_fixture(key_path, kid, {
            "checkout": True, "disabled": False,
            "ExpressCheckout": {"requirement": "all", "rules": [{
                "property": "Vip", "op": "eq", "type": "boolean", "value": "true"
            }]}
        })
        variants = signed_fixture(key_path, kid, {
            "checkout": {"enabled": True, "variant": "blue", "configurationValue": 7},
            "disabled": {"enabled": False}
        })

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            first_lock = threading.Lock()
            ambiguous_sent = False

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
                encoding = self.headers.get("Content-Encoding", "plain")
                packet = json.loads(gzip.decompress(raw) if encoding == "gzip" else raw)
                record = {
                    "path": self.path, "encoding": encoding,
                    "origin": self.headers.get("Origin"),
                    "cookie": self.headers.get("Cookie"),
                    "authorization": self.headers.get("Authorization"),
                    "packet": packet
                }
                with open(args.output, "a", encoding="utf-8") as stream:
                    stream.write(json.dumps(record, separators=(",", ":")) + "\n")
                with Handler.first_lock:
                    ambiguous = args.ambiguous_first and not Handler.ambiguous_sent
                    if ambiguous:
                        Handler.ambiguous_sent = True
                if ambiguous:
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    self.close_connection = True
                    return
                self.send_response(202)
                self.send_header("Content-Length", "0")
                self.end_headers()

        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
        print(f"Collector listening on http://127.0.0.1:{args.port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
