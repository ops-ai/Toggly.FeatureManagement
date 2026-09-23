"""Local collector contract tests; all sockets bind to loopback."""
import argparse
import gzip
import http.client
import json
import os
import select
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import collector


HERE = Path(__file__).resolve().parent
HOST = HERE.parent


def collector_worker():
    """Run the unchanged collector CLI inside a parent-owned test process."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--collector-worker", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("normal", "signing", "constructor",
                                           "partial", "failed", "ignore-term",
                                           "invalid-ready", "invalid-port", "overflow",
                                           "descendant-term", "descendant-exit",
                                           "descendant-ready"), required=True)
    parser.add_argument("--bind-marker", type=Path, required=True)
    args = parser.parse_args()

    # SIGTERM unwinds the collector's temporary signing directory and lets
    # coverage write subprocess data. The parent still has a bounded SIGKILL.
    signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(0))
    if args.mode.startswith("descendant-"):
        # Real descendant with its own live socket: it survives its parent's
        # default TERM exit and keeps the group (and stdout pipe) alive.
        descendant = subprocess.Popen([sys.executable, "-c", '''
import json, os, signal, socket, sys, time
from pathlib import Path
signal.signal(signal.SIGTERM, signal.SIG_IGN)
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
listener.listen()
marker = Path(sys.argv[1])
pending = marker.with_suffix(".tmp")
pending.write_text(json.dumps({"pid": os.getpid(), "port": listener.getsockname()[1]}))
pending.replace(marker)
time.sleep(60)
''', str(args.bind_marker)])
        deadline = time.monotonic() + 5
        while not args.bind_marker.exists():
            if descendant.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError("descendant did not start")
            time.sleep(0.01)
        print(f"START {args.mode}", flush=True)
        if args.mode == "descendant-exit":
            raise SystemExit(17)
        if args.mode == "descendant-ready":
            print(f"READY {json.loads(args.bind_marker.read_text())['port']}", flush=True)
        time.sleep(60)
        return
    if args.mode in ("partial", "failed", "ignore-term", "invalid-ready", "invalid-port", "overflow"):
        if args.mode == "ignore-term":
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
        print(f"START {args.mode}", flush=True)
        if args.mode == "failed":
            raise SystemExit(17)
        if args.mode == "partial":
            print("REA", end="", flush=True)
        elif args.mode == "invalid-ready":
            print("READY invalid", flush=True)
        elif args.mode == "invalid-port":
            print("READY 0", flush=True)
        elif args.mode == "overflow":
            print("X" * 8192, end="", flush=True)
        time.sleep(60)
        return
    original_temporary = collector.tempfile.TemporaryDirectory

    def private_temporary(*positional, **options):
        if options.get("prefix") == "ops1388-signing-":
            options["dir"] = args.output.parent
        return original_temporary(*positional, **options)

    collector.tempfile.TemporaryDirectory = private_temporary
    original_server = collector.ThreadingHTTPServer
    original_bind = original_server.server_bind

    def tracked_bind(server):
        if args.mode == "constructor":
            print("START constructor", flush=True)
            time.sleep(5)
        original_bind(server)
        if args.mode != "normal":
            args.bind_marker.write_text(str(server.server_address[1]))

    original_server.server_bind = tracked_bind
    if args.mode == "signing":
        original_run = collector.subprocess.run

        def slow_signing(command, **options):
            if command[1] == "ecparam":
                print("START signing", flush=True)
                time.sleep(5)
            return original_run(command, **options)

        collector.subprocess.run = slow_signing

    def ready_server(address, handler):
        server = original_server(address, handler)
        print(f"READY {server.server_address[1]}", flush=True)
        return server

    collector.ThreadingHTTPServer = ready_server
    sys.argv = ["collector.py", "--port", "0", "--output", str(args.output)]
    if args.mode == "normal" and os.environ.get("OPS1398_AMBIGUOUS_FIRST") == "1":
        sys.argv.append("--ambiguous-first")
    collector.main()


class CollectorTest(unittest.TestCase):
    def assert_group_stopped(self):
        self.assertIsNotNone(self.collector_process.poll(), "leader was not reaped")
        with self.assertRaises(ProcessLookupError, msg="collector group survived cleanup"):
            os.killpg(self.collector_process.pid, 0)

    def test_invalid_readiness_stops_group_before_returning(self):
        for mode, message in (("invalid-ready", "invalid collector ready line"),
                              ("invalid-port", "invalid collector ready port"),
                              ("overflow", "readiness output exceeded")):
            with self.subTest(mode=mode):
                with self.assertRaisesRegex(AssertionError, message):
                    self.run_collector(mode=mode)
                self.assert_group_stopped()

    def assert_descendant_stopped(self):
        descendant = json.loads(self.bind_marker.read_text())
        try:
            self.assert_group_stopped()
            with self.assertRaises(ProcessLookupError, msg="descendant survived collector cleanup"):
                os.kill(descendant["pid"], 0)
            with self.assertRaises(OSError, msg="descendant socket survived collector cleanup"):
                socket.create_connection(("127.0.0.1", descendant["port"]), timeout=0.2)
        finally:
            # Independent emergency cleanup keeps a failing regression from
            # leaving its intentionally TERM-ignoring process behind.
            try:
                os.killpg(self.collector_process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def test_ignored_term_descendant_stops_after_leader_exits_on_term(self):
        with self.assertRaisesRegex(AssertionError, "collector did not bind"):
            self.run_collector(mode="descendant-term", startup_timeout=0.1)
        self.assert_descendant_stopped()

    def test_ignored_term_descendant_stops_after_leader_already_exited(self):
        with self.assertRaisesRegex(AssertionError, "collector did not bind"):
            self.run_collector(mode="descendant-exit", startup_timeout=0.1)
        self.assertEqual(self.collector_process.returncode, 17)
        self.assert_descendant_stopped()

    def test_normal_disposal_stops_ignored_term_descendant(self):
        self.run_collector(mode="descendant-ready")
        self.stop_collector()
        self.assert_descendant_stopped()

    def test_partial_ready_is_bounded_and_stops_child(self):
        with self.assertRaisesRegex(AssertionError, "collector did not bind"):
            self.run_collector(mode="partial", startup_timeout=0.1)
        self.assertIsNotNone(self.collector_process.poll())
        self.assertFalse(self.bind_marker.exists())

    def test_failed_child_is_bounded(self):
        with self.assertRaisesRegex(AssertionError, "collector did not bind"):
            self.run_collector(mode="failed", startup_timeout=0.1)
        self.assertEqual(self.collector_process.returncode, 17)

    def test_ignored_terminate_uses_bounded_kill(self):
        with self.assertRaisesRegex(AssertionError, "collector did not bind"):
            self.run_collector(mode="ignore-term", startup_timeout=0.1)
        self.assertLess(self.cleanup_seconds, 4.5)
        self.assertIsNotNone(self.collector_process.poll())

    def test_normal_disposal_stops_child(self):
        port, _ = self.run_collector()
        status, _ = self.request(port, "GET", "/.well-known/jwks")
        self.assertEqual(status, 200)
        process = self.collector_process
        self.stop_collector()
        self.assertIsNotNone(process.poll())
        self.assert_group_stopped()
        with self.assertRaises(OSError):
            socket.create_connection(("127.0.0.1", port), timeout=0.2)
        self.stop_collector()  # Repeated disposal must be harmless.

    def assert_no_post_cleanup_bind(self, mode):
        with self.assertRaisesRegex(AssertionError, "collector did not bind"):
            self.run_collector(mode=mode, startup_timeout=0.1)
        process = self.collector_process
        marker = self.bind_marker
        self.assertIsNotNone(process.poll(), "collector child survived timeout cleanup")
        self.assert_group_stopped()
        # Remain alive past the injected five-second delay. The worker writes
        # this marker on every successful bind, including a transient one.
        deadline = time.monotonic() + 5.5
        while time.monotonic() < deadline:
            self.assertFalse(marker.exists(), f"{mode} bound after timeout cleanup")
            time.sleep(0.02)

    def test_slow_signing_never_binds_after_cleanup(self):
        self.assert_no_post_cleanup_bind("signing")

    def test_slow_constructor_never_binds_after_cleanup(self):
        self.assert_no_post_cleanup_bind("constructor")

    def run_collector(self, ambiguous=False, mode="normal", startup_timeout=60):
        temporary = tempfile.TemporaryDirectory()
        output = Path(temporary.name) / "packets.jsonl"
        marker = Path(temporary.name) / "bound-port.txt"
        self.bind_marker = marker
        log = (Path(temporary.name) / "collector.log").open("wb")
        command = [sys.executable]
        try:
            import coverage
            tracing = coverage.Coverage.current() is not None
        except ImportError:
            tracing = False
        if tracing and mode == "normal":
            command += ["-m", "coverage", "run", "--parallel-mode", "--source=tool"]
        command += [str(Path(__file__).resolve()), "--collector-worker", "--output", str(output),
                    "--mode", mode, "--bind-marker", str(marker)]
        environment = os.environ.copy()
        environment["OPS1398_AMBIGUOUS_FIRST"] = "1" if ambiguous else "0"
        try:
            process = subprocess.Popen(command, cwd=HOST, env=environment,
                                       stdout=subprocess.PIPE, stderr=log,
                                       start_new_session=True)
        except BaseException:
            log.close()
            temporary.cleanup()
            raise
        self.collector_process = process
        stopped = False

        def signal_group(value):
            # The group ID remains ours after its leader exits. Never gate
            # signalling or escalation on the direct child's return code.
            try:
                os.killpg(process.pid, value)
                return True
            except ProcessLookupError:
                return False
            except PermissionError:
                # macOS may return EPERM while killed group members await
                # reaping (including orphans being reaped by launchd). This
                # still means the group EXISTS: only ESRCH proves it is gone.
                # Persistent permission failures therefore fail the deadline.
                return True

        def wait_for_group(timeout):
            deadline = time.monotonic() + timeout
            while True:
                process.poll()  # Reap the direct child as soon as it exits.
                if not signal_group(0):
                    return True
                if time.monotonic() >= deadline:
                    return False
                time.sleep(0.02)

        def cleanup():
            nonlocal stopped
            if stopped:
                return
            started = time.monotonic()
            try:
                signal_group(signal.SIGTERM)
                if not wait_for_group(1):
                    signal_group(signal.SIGKILL)
                    self.assertTrue(wait_for_group(3), "collector process group did not stop")
                process.wait(timeout=1)
                stopped = True
            finally:
                self.cleanup_seconds = time.monotonic() - started
                process.stdout.close()
                log.close()

        def dispose():
            cleanup()
            # Keep the marker and log available for assertions until disposal.
            # If group teardown fails, do not release its files underneath it.
            temporary.cleanup()

        self.addCleanup(dispose)
        self.stop_collector = cleanup
        pending = b""

        def next_line(deadline):
            nonlocal pending
            while True:
                if b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    return line.decode("ascii", errors="replace")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                readable, _, _ = select.select([process.stdout], [], [], min(remaining, 0.2))
                if readable:
                    chunk = os.read(process.stdout.fileno(), 4096)
                    if not chunk:
                        return None
                    pending += chunk
                    if len(pending) > 4096:
                        raise AssertionError("collector readiness output exceeded 4096 bytes")
                elif process.poll() is not None:
                    return None

        try:
            if mode != "normal":
                line = next_line(time.monotonic() + 10)
                if line != f"START {mode}":
                    raise AssertionError(f"collector did not enter delayed {mode} path: {line}")
            deadline = time.monotonic() + startup_timeout
            while True:
                line = next_line(deadline)
                if line is None:
                    raise AssertionError("collector did not bind")
                if line.startswith("READY "):
                    try:
                        port = int(line.removeprefix("READY "))
                    except ValueError as error:
                        raise AssertionError(f"invalid collector ready line: {line}") from error
                    if not 0 < port < 65536:
                        raise AssertionError(f"invalid collector ready port: {port}")
                    return port, output
        except BaseException:
            cleanup()
            raise

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


if __name__ == "__main__":
    collector_worker()
