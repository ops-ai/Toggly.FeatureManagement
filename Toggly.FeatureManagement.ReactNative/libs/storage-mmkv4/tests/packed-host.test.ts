import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const sharedArtifacts: string[] = JSON.parse(process.env.TOGGLY_SHARED_ARTIFACTS ?? '[]');
const { packCore } = require('../../../tests/packed-core.cjs');
let corePackage: { archive: string; dispose(): void };
beforeAll(() => { corePackage = packCore(); }, 120000);
afterAll(() => corePackage?.dispose());

const packageDirectory = resolve(__dirname, '..');
const fixturesDirectory = join(__dirname, 'fixtures', 'packed-host');

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const result = error as { stderr?: string; stdout?: string };
    throw new Error(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

describe('packed MMKV 4 host', () => {
  it('requires the Nitro line that supports the current React Native JSI hook', () => {
    const manifest = require('../package.json') as {
      peerDependencies: Record<string, string>;
    };

    expect(manifest.peerDependencies['react-native-nitro-modules']).toBe('^0.37.1');
  });

  it('installs, typechecks, and uses the packed adapter with MMKV 4 and Nitro', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'toggly-mmkv4-host-'));
    let tarball: string | undefined;

    try {
      run('npm', ['run', 'build'], packageDirectory);
      const packed = JSON.parse(run('npm', ['pack', '--json'], packageDirectory));
      tarball = join(packageDirectory, packed[0].filename);
      cpSync(fixturesDirectory, temporaryDirectory, { recursive: true });
      cpSync(join(packageDirectory, '..', '..', 'tests', 'telemetry-consumer.cjs'), join(temporaryDirectory, 'telemetry-consumer.cjs'));

      run(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball, ...sharedArtifacts, corePackage.archive],
        temporaryDirectory
      );
      run('npm', ['run', 'typecheck'], temporaryDirectory);
      run('npm', ['run', 'verify'], temporaryDirectory);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
      if (tarball) rmSync(tarball, { force: true });
    }
  }, 120000);
});
