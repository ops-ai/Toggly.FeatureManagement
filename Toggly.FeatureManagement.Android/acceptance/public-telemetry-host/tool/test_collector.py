"""Local collector contract tests; all sockets bind to loopback."""
import gzip
import http.client
import json
import stat
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import collector


class CollectorTest(unittest.TestCase):
    def run_collector(self, ambiguous=False):
        temporary = tempfile.TemporaryDirectory()
        output = Path(temporary.name) / "packets.jsonl"
        ready = threading.Event()
        active = {}
        original_server = collector.ThreadingHTTPServer

        def create_server(address, handler):
            server = original_server(address, handler)
            active["server"] = server
            ready.set()
            return server

        arguments = ["collector.py", "--port", "0", "--output", str(output)]
        if ambiguous:
            arguments.append("--ambiguous-first")
        argv_patch = patch("sys.argv", arguments)
        server_patch = patch.object(collector, "ThreadingHTTPServer", side_effect=create_server)
        argv_patch.start()
        server_patch.start()
        thread = threading.Thread(target=collector.main)
        thread.start()
        self.assertTrue(ready.wait(10), "collector did not bind")
        server = active["server"]

        def cleanup():
            server.shutdown()
            server.server_close()
            thread.join(timeout=10)
            server_patch.stop()
            argv_patch.stop()
            temporary.cleanup()
            self.assertFalse(thread.is_alive(), "collector did not stop")

        self.addCleanup(cleanup)
        return server.server_address[1], output

    @staticmethod
    def request(port, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()

    def test_signed_fixtures_and_plain_gzip_packets(self):
        port, output = self.run_collector()
        status, jwks = self.request(port, "GET", "/.well-known/jwks")
        self.assertEqual(status, 200)
        key = json.loads(jwks)["keys"][0]
        self.assertEqual(key["alg"], "ES256")
        self.assertTrue(key["kid"].endswith("ES256"))
        for path in ("/evaluated-signed/k/Acceptance", "/evaluated-variants-signed/k/Acceptance"):
            status, body = self.request(port, "GET", path)
            self.assertEqual(status, 200)
            signed = json.loads(body)
            self.assertEqual(signed["kid"], key["kid"])
            self.assertIn("signature", signed)
        status, _ = self.request(port, "GET", "/unknown")
        self.assertEqual(status, 404)
        status, _ = self.request(port, "POST", "/unknown", b"{}")
        self.assertEqual(status, 404)
        packet = {"k": "fixture", "e": "Acceptance", "f": {"checkout": {"enabled": [1, 1, 1]}}}
        raw = json.dumps(packet).encode()
        for body, encoding in ((raw, None), (gzip.compress(raw), "gzip")):
            headers = {"Content-Type": "application/json"}
            if encoding:
                headers["Content-Encoding"] = encoding
            status, _ = self.request(port, "POST", "/api/frontend/telemetry", body, headers)
            self.assertEqual(status, 202)
        rows = [json.loads(line) for line in output.read_text().splitlines()]
        self.assertEqual([row["encoding"] for row in rows], ["plain", "gzip"])
        self.assertEqual([row["packet"] for row in rows], [packet, packet])
        self.assertTrue(all(row[field] is None for row in rows for field in ("origin", "cookie", "authorization")))

    def test_ambiguous_first_packet_is_recorded_once(self):
        port, output = self.run_collector(ambiguous=True)
        packet = {"k": "fixture", "e": "Acceptance", "f": {"checkout": {"enabled": [1, 1, 1]}}}
        raw = json.dumps(packet).encode()
        with self.assertRaises((http.client.RemoteDisconnected, ConnectionResetError)):
            self.request(port, "POST", "/api/frontend/telemetry", raw)
        status, _ = self.request(port, "POST", "/api/frontend/telemetry", raw)
        self.assertEqual(status, 202)
        rows = [json.loads(line) for line in output.read_text().splitlines()]
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["packet"] for row in rows], [packet, packet])

    def test_rejects_invalid_der_signature(self):
        with self.assertRaises(ValueError):
            collector.raw_signature(b"invalid")
        self.assertEqual(collector.compact({"a": 1}), b'{"a":1}')

    def test_packet_output_is_private_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "packets.jsonl"
            record = {"packet": {"k": "fixture"}}
            collector.append_packet(output, record)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            self.assertEqual(json.loads(output.read_text()), record)

            target = Path(directory) / "target.jsonl"
            target.write_text("unchanged\n")
            link = Path(directory) / "link.jsonl"
            link.symlink_to(target)
            with self.assertRaises(OSError):
                collector.append_packet(link, record)
            self.assertEqual(target.read_text(), "unchanged\n")
