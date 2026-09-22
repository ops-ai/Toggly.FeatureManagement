#!/usr/bin/env python3
"""Verify manifest parity and a real SwiftPM Git consumer (never a path dependency)."""
import argparse
import copy
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
SDK = 'Toggly.FeatureManagement.iOS'
PRODUCTS = ('TogglyCore', 'TogglySwiftUI', 'TogglyUIKit', 'TogglyCombine')


def retire_process_group(process):
    """Retire the known session even after its parent has already exited."""
    failures = []
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except BaseException as error:
        failures.append(error)
    # Reap the direct child and close our pipe independently of signal failures.
    try:
        process.wait(timeout=5)
    except BaseException as error:
        failures.append(error)
    try:
        process.stdout.close()
    except BaseException as error:
        failures.append(error)
    if failures:
        if len(failures) == 1:
            raise failures[0]
        raise RuntimeError('Owned command cleanup failed', failures)
    deadline = time.monotonic() + 5
    while True:
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            # After SIGKILL, some macOS runners report EPERM for an empty or
            # reparented session instead of ESRCH. The group is no longer ours.
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('Owned command process group did not exit')
        time.sleep(0.02)


def run(command, cwd, timeout=300):
    print('+', ' '.join(map(str, command)), flush=True)
    process = subprocess.Popen(command, cwd=cwd, start_new_session=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    failure = None
    try:
        output, _ = process.communicate(timeout=timeout)
        if process.returncode:
            failure = subprocess.CalledProcessError(process.returncode, command, output)
        print(output, end='', flush=True)
    except BaseException as error:
        # Keep a known command failure primary even if printing its output fails.
        if failure is None:
            failure = error
        else:
            failure.__cause__ = error
    try:
        retire_process_group(process)
    except BaseException as cleanup_error:
        if failure is not None:
            raise failure from cleanup_error
        raise
    if failure is not None:
        raise failure
    return output


def manifest(root):
    return json.loads(run(['swift', 'package', '--disable-sandbox', 'dump-package'], root))


def assert_parity(top, nested, root):
    normalized = copy.deepcopy(top)
    # packageKind contains only the absolute checkout location, not package metadata.
    normalized.pop('packageKind', None)
    expected = copy.deepcopy(nested)
    expected.pop('packageKind', None)
    assert set(p['name'] for p in top['products']) == set(PRODUCTS), 'missing or extra product'
    assert len(top['targets']) == 8, 'expected four library and four test targets'
    for target in normalized['targets']:
        path = target['path']
        assert path.startswith(SDK + '/'), 'root target must reference the existing SDK directory'
        assert (root / path).is_dir(), 'target source path does not exist: ' + path
        target['path'] = path[len(SDK) + 1:]
    assert normalized == expected, 'root and nested package metadata differ'


def consume(repository, revision, temporary, consumer_target=None, consumer_sdk=None):
    consumer = temporary / 'consumer'
    consumer.mkdir()
    # SwiftPM derives this identity from the Git URL, including file:// mirrors.
    identity = repository.rstrip('/').split('/')[-1].removesuffix('.git').lower()
    products = ', '.join('.product(name: ' + json.dumps(p) + ', package: ' + json.dumps(identity) + ')' for p in PRODUCTS)
    (consumer / 'Package.swift').write_text('''// swift-tools-version:5.5
import PackageDescription
let package = Package(name: "DistributionConsumer", platforms: [.macOS(.v11), .iOS(.v14), .tvOS(.v14), .watchOS(.v7)],
 dependencies: [.package(url: %s, revision: %s)],
 targets: [.executableTarget(name: "DistributionConsumer", dependencies: [%s])])
''' % (json.dumps(repository), json.dumps(revision), products))
    source = consumer / 'Sources/DistributionConsumer'
    source.mkdir(parents=True)
    (source / 'main.swift').write_text('''import TogglyCore
import TogglySwiftUI
import TogglyUIKit
import TogglyCombine
precondition(togglyVersion == togglySwiftUIVersion)
#if canImport(UIKit) && !os(watchOS)
precondition(togglyVersion == togglyUIKitVersion)
#endif
precondition(togglyVersion == togglyCombineVersion)
print("Four Git products imported at " + togglyVersion)
''')
    run(['swift', 'package', '--disable-sandbox', 'resolve'], consumer)
    pins = json.loads((consumer / 'Package.resolved').read_text())
    entries = pins.get('pins', pins.get('object', {}).get('pins', []))
    assert len(entries) == 1, 'expected one Git dependency'
    state = entries[0]['state']
    resolved = state['revision']
    assert len(resolved) == 40, 'Git resolution must pin a commit'
    if len(revision) == 40:
        assert resolved == revision, 'resolved a different Git revision'
    run(['swift', 'run', '--disable-sandbox', '-j', '2', 'DistributionConsumer'], consumer)
    if consumer_target:
        run(['swift', 'build', '--disable-sandbox', '-j', '2', '--triple', consumer_target,
             '--sdk', consumer_sdk, '--scratch-path', str(temporary / 'consumer-platform')], consumer)
    print(json.dumps({'repository': repository, 'requested': revision, 'resolved': resolved,
                      'products': PRODUCTS}), flush=True)
    return resolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', help='Real Git URL; omitted uses a temporary bare mirror of this checkout')
    parser.add_argument('--revision', default='HEAD', help='Exact commit or retained prefixed release reference')
    parser.add_argument('--parity-only', action='store_true')
    parser.add_argument('--consumer-target', help='Optional installed platform triple for an additional Git consumer build')
    parser.add_argument('--consumer-sdk', help='SDK path paired with --consumer-target')
    args = parser.parse_args()
    if bool(args.consumer_target) != bool(args.consumer_sdk):
        parser.error('--consumer-target and --consumer-sdk must be supplied together')
    assert_parity(manifest(ROOT), manifest(ROOT / SDK), ROOT)
    if args.parity_only:
        return
    with tempfile.TemporaryDirectory(prefix='toggly-swift-distribution-') as directory:
        temporary = Path(directory)
        run(['swift', 'package', '--disable-sandbox', '--scratch-path', str(temporary / 'root-build'), 'resolve'], ROOT)
        run(['swift', 'build', '--disable-sandbox', '-j', '2', '--scratch-path', str(temporary / 'root-build')], ROOT)
        repository = args.repository
        revision = args.revision
        if not repository:
            revision = run(['git', 'rev-parse', revision + '^{commit}'], ROOT).strip()
            mirror = temporary / 'Toggly.FeatureManagement.git'
            run(['git', 'clone', '--bare', '--quiet', str(ROOT), str(mirror)], ROOT)
            repository = mirror.as_uri()
            print('Local Git mirror: intermediate exact-revision evidence, not public installation proof.', flush=True)
        consume(repository, revision, temporary, args.consumer_target, args.consumer_sdk)


def interrupted(signum, _frame):
    raise SystemExit(128 + signum)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    main()
