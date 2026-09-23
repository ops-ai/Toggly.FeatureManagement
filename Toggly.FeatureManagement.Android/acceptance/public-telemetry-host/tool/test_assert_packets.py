"""Packet assertion checks using synthetic fixture records."""
import json
import io
import unittest
from unittest.mock import patch

import assert_packets


def record(packet, encoding="gzip"):
    return {"path": "/api/frontend/telemetry", "encoding": encoding,
            "origin": None, "cookie": None, "authorization": None, "packet": packet}


class PacketAssertionTest(unittest.TestCase):
    def test_complete_capture_and_missing_teardown(self):
        first = {"k": "local-public-android", "e": "Acceptance", "u": "native-a",
                 "f": {"checkout": {"preview-a": [1, 1, 1]}}, "m": {"orders": 2, "queue": 3.5}}
        replacement = {"k": "local-public-android", "e": "Acceptance", "i": "local-minted-fixture",
                       "f": {"after-replacement": {"enabled": [0, 1, 0]}}}
        teardown = {"k": "local-public-android", "e": "Acceptance", "i": "local-minted-fixture",
                    "f": {"teardown": {"enabled": [0, 1, 0]}}}
        rows = [record(first), record(replacement), record(teardown, "plain")]
        with patch("sys.stdin", io.StringIO("\n".join(json.dumps(row) for row in rows) + "\n")):
            assert_packets.main()
        with patch("sys.stdin", io.StringIO("\n".join(json.dumps(row) for row in rows[:-1]) + "\n")):
            with self.assertRaisesRegex(AssertionError, "plain final-disposal"):
                assert_packets.main()
