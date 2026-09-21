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
