#!/usr/bin/env python3
"""Distribution contract checks, including real Git resolver negative controls."""
import copy
import fnmatch
import importlib.util
from pathlib import Path
import re
import os
import sys
import time
import signal
from unittest import mock
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('distribution', Path(__file__).with_name('verify-swift-distribution.py'))
distribution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(distribution)
ROOT = distribution.ROOT


class DistributionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.top = distribution.manifest(ROOT)
        cls.nested = distribution.manifest(ROOT / distribution.SDK)

    def test_metadata_parity(self):
        distribution.assert_parity(self.top, self.nested, ROOT)

    def test_missing_product_is_rejected(self):
        changed = copy.deepcopy(self.top)
        changed['products'].pop()
        with self.assertRaisesRegex(AssertionError, 'product'):
            distribution.assert_parity(changed, self.nested, ROOT)

    def test_wrong_existing_path_is_rejected(self):
        changed = copy.deepcopy(self.top)
        changed['targets'][0]['path'] = changed['targets'][1]['path']
        with self.assertRaisesRegex(AssertionError, 'metadata differ'):
            distribution.assert_parity(changed, self.nested, ROOT)

    def test_missing_source_path_is_rejected(self):
        changed = copy.deepcopy(self.top)
        changed['targets'][0]['path'] += '/absent'
        with self.assertRaisesRegex(AssertionError, 'does not exist'):
            distribution.assert_parity(changed, self.nested, ROOT)

    def test_platform_linker_and_tools_drift_is_rejected(self):
        for mutate in [lambda p: p['platforms'].pop(),
                       lambda p: p['targets'][0].update(settings=[]),
                       lambda p: p['toolsVersion'].update(_version='5.6.0')]:
            changed = copy.deepcopy(self.top)
            mutate(changed)
            with self.assertRaises(AssertionError):
                distribution.assert_parity(changed, self.nested, ROOT)

    def test_existing_workflow_filters_select_distribution_inputs(self):
        for name, event in [('analysis-ios.yml', 'pull_request'), ('sdk-ios-release.yml', 'push')]:
            workflow = (ROOT / '.github/workflows' / name).read_text()
            # Parse only this event's paths block, not arbitrary YAML/page tokens.
            block = re.search(r'^  ' + event + r':\n(.*?)(?=^  \w|^\w)', workflow, re.M | re.S).group(1)
            paths = re.search(r'^    paths:\n((?:      - .*\n)+)', block, re.M).group(1)
            patterns = re.findall(r"^      - '([^']+)'$", paths, re.M)
            for path in ['Package.swift', '.github/scripts/verify-swift-distribution.py',
                         '.github/scripts/verify-swift-distribution.test.py']:
                self.assertTrue(any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns), (name, path))
            self.assertFalse(any(fnmatch.fnmatchcase('Unrelated/Package.swift', pattern) for pattern in patterns))
        analysis = (ROOT / '.github/workflows/analysis-ios.yml').read_text()
        self.assertIn('--repository "https://github.com/${{ github.repository }}.git" --revision "$(git rev-parse HEAD)"', analysis)
        self.assertIn('python3 .github/scripts/verify-swift-distribution.test.py', analysis)

    def test_deadline_reaps_owned_child_processes(self):
        with tempfile.TemporaryDirectory(prefix='toggly-swift-deadline-') as directory:
            root = Path(directory)
            child = root / 'child.pid'
            code = 'import subprocess,sys,time,pathlib; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);pathlib.Path(sys.argv[1]).write_text(str(p.pid));time.sleep(60)'
            with self.assertRaises(subprocess.TimeoutExpired):
                distribution.run([sys.executable, '-c', code, str(child)], root, timeout=2)
            self.assertTrue(child.exists(), 'negative control must start its actual child')
            pid = int(child.read_text())
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
            else:
                self.fail('owned subprocess survived the command deadline')

    def assert_owned_pid_absent(self, pid):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.02)
        self.fail('owned descendant survived completed parent')

    def completed_parent(self, exit_code, fail_logging=False, deny_cleanup=False):
        with tempfile.TemporaryDirectory(prefix='toggly-swift-completed-') as directory:
            root = Path(directory)
            marker = root / 'child.pid'
            code = 'import subprocess,sys,pathlib;p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);pathlib.Path(sys.argv[1]).write_text(str(p.pid));print("completed-parent-output");sys.exit(int(sys.argv[2]))'
            original_print = print
            original_killpg = os.killpg
            def output(*args, **kwargs):
                if fail_logging and args and 'completed-parent-output' in str(args[0]) and args[0] != '+':
                    raise OSError('Injected output failure')
                return original_print(*args, **kwargs)
            def killpg(pid, kind):
                if deny_cleanup and kind == signal.SIGKILL:
                    raise PermissionError('Injected cleanup denial')
                return original_killpg(pid, kind)
            try:
                with mock.patch('builtins.print', side_effect=output), mock.patch.object(distribution.os, 'killpg', side_effect=killpg):
                    if exit_code:
                        with self.assertRaises(subprocess.CalledProcessError) as failure:
                            distribution.run([sys.executable, '-c', code, str(marker), str(exit_code)], root)
                        self.assertEqual(failure.exception.returncode, exit_code)
                        if deny_cleanup:
                            self.assertIsInstance(failure.exception.__cause__, PermissionError)
                    elif fail_logging:
                        with self.assertRaisesRegex(OSError, 'Injected output failure'):
                            distribution.run([sys.executable, '-c', code, str(marker), '0'], root)
                    else:
                        self.assertIn('completed-parent-output', distribution.run([sys.executable, '-c', code, str(marker), '0'], root))
                self.assertTrue(marker.exists(), 'actual descendant must start')
                pid = int(marker.read_text())
                if deny_cleanup:
                    os.kill(pid, 0)  # A denied kill must not become false success.
                else:
                    self.assert_owned_pid_absent(pid)
            finally:
                if marker.exists():
                    pid = int(marker.read_text())
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    self.assert_owned_pid_absent(pid)

    def test_successful_parent_reaps_owned_descendant(self):
        self.completed_parent(0)

    def test_failed_parent_reaps_owned_descendant_and_retains_exit(self):
        self.completed_parent(7)

    def test_output_failure_still_reaps_owned_descendant(self):
        self.completed_parent(0, fail_logging=True)

    def test_cleanup_failure_retains_original_command_failure(self):
        self.completed_parent(7, deny_cleanup=True)

    def test_interruption_reaps_owned_command_group(self):
        with tempfile.TemporaryDirectory(prefix='toggly-swift-interrupt-') as directory:
            root = Path(directory)
            marker = root / 'pids'
            code = 'import os,subprocess,sys,pathlib,time;p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);pathlib.Path(sys.argv[1]).write_text(str(os.getpid())+" "+str(p.pid));time.sleep(60)'
            worker_code = ('import importlib.util,signal,sys;'
                           's=importlib.util.spec_from_file_location("verifier",sys.argv[1]);'
                           'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                           'signal.signal(signal.SIGTERM,m.interrupted);'
                           'm.run([sys.executable,"-c",sys.argv[2],sys.argv[3]],sys.argv[4])')
            worker = subprocess.Popen([sys.executable, '-c', worker_code,
                                       str(ROOT / '.github/scripts/verify-swift-distribution.py'),
                                       code, str(marker), str(root)], start_new_session=True,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 5
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(marker.exists(), 'actual command and descendant must start')
                worker.send_signal(signal.SIGTERM)
                self.assertEqual(worker.wait(timeout=12), 128 + signal.SIGTERM)
                for pid in map(int, marker.read_text().split()):
                    self.assert_owned_pid_absent(pid)
            finally:
                if marker.exists():
                    parent_pid = int(marker.read_text().split()[0])
                    try:
                        os.killpg(parent_pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if worker.poll() is None:
                    worker.kill()
                worker.wait(timeout=5)

    def test_real_git_resolution_and_invalid_layouts(self):
        with tempfile.TemporaryDirectory(prefix='toggly-swift-contract-') as directory:
            temporary = Path(directory)
            fixture = temporary / 'Toggly.FeatureManagement'
            fixture.mkdir()
            for product in distribution.PRODUCTS:
                source = fixture / 'Sources' / product
                source.mkdir(parents=True)
                version = 'togglyVersion' if product == 'TogglyCore' else product[0].lower() + product[1:] + 'Version'
                (source / 'Version.swift').write_text('public let ' + version + ' = "fixture"\n')
            products = ','.join('.library(name: "' + p + '", targets: ["' + p + '"])' for p in distribution.PRODUCTS)
            targets = ','.join('.target(name: "' + p + '")' for p in distribution.PRODUCTS)
            manifest = '// swift-tools-version:5.5\nimport PackageDescription\nlet package = Package(name: "Toggly", products: [' + products + '], targets: [' + targets + '])\n'
            def commit(text):
                package = fixture / 'Package.swift'
                if text is None:
                    package.unlink(missing_ok=True)
                else:
                    package.write_text(text)
                distribution.run(['git', 'add', '.'], fixture)
                distribution.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                                  '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Isolated distribution fixture'], fixture)
                return distribution.run(['git', 'rev-parse', 'HEAD'], fixture).strip()
            distribution.run(['git', 'init', '-q'], fixture)
            revision = commit(manifest)
            # This tag exists only in the disposable fixture. It is not an SDK release.
            tag = 'ios-sdk-v0.0.0-fixture'
            distribution.run(['git', 'tag', tag], fixture)
            positive = temporary / 'positive'; positive.mkdir()
            resolved = distribution.consume(fixture.as_uri(), tag, positive)
            self.assertEqual(resolved, revision)
            for label, invalid, message in [
                ('missing-root', None, 'Package.swift'),
                ('missing-product', manifest.replace('.library(name: "TogglyCombine", targets: ["TogglyCombine"])', '.library(name: "Other", targets: ["TogglyCombine"])'), 'TogglyCombine'),
                ('wrong-path', manifest.replace('.target(name: "TogglyCore")', '.target(name: "TogglyCore", path: "absent")'), 'absent')]:
                with self.subTest(label=label):
                    revision = commit(invalid)
                    destination = temporary / label; destination.mkdir()
                    with self.assertRaises(subprocess.CalledProcessError) as failure:
                        distribution.consume(fixture.as_uri(), revision, destination)
                    self.assertIn(message, failure.exception.output)


if __name__ == '__main__':
    unittest.main()
