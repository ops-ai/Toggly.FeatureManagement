from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import pytest

from toggly.segments import SegmentMembershipClient


class _Handler(BaseHTTPRequestHandler):
    last = None

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        type(self).last = {
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "body": json.loads(body.decode("utf-8")),
        }
        payload = json.dumps({"id": "list-1", "itemCount": 1}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A003
        return


@pytest.fixture()
def membership_server():
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()


def test_add_segment_members_posts_identifiers(membership_server):
    client = SegmentMembershipClient("backend-key", membership_server)
    summary = client.add_segment_members("Beta Testers", ["user-1"])
    assert summary["id"] == "list-1"
    assert _Handler.last["authorization"] == "backend-key"
    assert _Handler.last["path"].endswith("/api/v2/segments/Beta%20Testers/items")
    assert _Handler.last["body"] == {"identifiers": ["user-1"]}


def test_empty_success_body_returns_none(membership_server):
    class EmptyHandler(BaseHTTPRequestHandler):
        def do_DELETE(self):  # noqa: N802
            self.send_response(204)
            self.end_headers()

        def log_message(self, format, *args):  # noqa: A003
            return

    server = HTTPServer(("127.0.0.1", 0), EmptyHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = SegmentMembershipClient(
            "backend-key", f"http://127.0.0.1:{server.server_port}"
        )
        assert client.remove_segment_members("beta", ["user-1"]) is None
    finally:
        server.shutdown()


def test_requires_app_key():
    with pytest.raises(ValueError):
        SegmentMembershipClient("")


def test_transport_failure_raises_runtime_error():
    client = SegmentMembershipClient("backend-key", "http://127.0.0.1:1")
    with pytest.raises(RuntimeError, match="failed"):
        client.list_segments()
