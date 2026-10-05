#!/usr/bin/env python3
"""Public-only diagnostics for a failed Java Central deployment."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
from io import StringIO
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("report-java-signature-fingerprint.py")
spec = importlib.util.spec_from_file_location("java_signature", SCRIPT)
java_signature = importlib.util.module_from_spec(spec)
spec.loader.exec_module(java_signature)


class JavaSignatureFingerprintTests(unittest.TestCase):
    def test_reports_only_issuer_fingerprint_from_generated_pom_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            signature = Path(directory) / "toggly-core-2.1.5.pom.asc"
            signature.touch()
            packet_output = (
                ":signature packet: algo 1, keyid 165F0E2747ACFDE8\n"
                "\thashed subpkt 33 len 21 (issuer fpr v4 "
                "840BF8339B3EBAC85E9C6B81165F0E2747ACFDE8)\n"
                "private-looking input must never be echoed\n"
            )
            with mock.patch.object(java_signature.subprocess, "run", return_value=subprocess.CompletedProcess(
                args=[], returncode=0, stdout=packet_output, stderr="secret-looking stderr"
            )) as run, mock.patch.object(sys, "argv", [str(SCRIPT), str(directory)]):
                stdout = StringIO()
                stderr = StringIO()
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    self.assertEqual(java_signature.main(), 0)
                self.assertEqual(
                    stdout.getvalue(),
                    "Java release signature issuer fingerprint: "
                    "840BF8339B3EBAC85E9C6B81165F0E2747ACFDE8\n",
                )
                self.assertEqual(stderr.getvalue(), "")
                run.assert_called_once_with(
                    ["gpg", "--batch", "--list-packets", str(signature)],
                    capture_output=True,
                    text=True,
                    check=False,
                )

    def test_missing_signature_is_reported_without_running_gpg(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(java_signature.subprocess, "run") as run:
                with self.assertRaisesRegex(ValueError, "one core POM signature"):
                    java_signature.fingerprint_from_directory(Path(directory))
                run.assert_not_called()

    def test_missing_full_fingerprint_rejects_key_id_only(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "toggly-core-2.1.5.pom.asc").touch()
            with mock.patch.object(java_signature.subprocess, "run", return_value=subprocess.CompletedProcess(
                args=[], returncode=0, stdout=":signature packet: keyid 165F0E2747ACFDE8", stderr=""
            )):
                with self.assertRaisesRegex(ValueError, "full issuer fingerprint"):
                    java_signature.fingerprint_from_directory(Path(directory))


if __name__ == "__main__":
    unittest.main()
