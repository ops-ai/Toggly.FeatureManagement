import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sharedArtifacts: string[] = JSON.parse(process.env.TOGGLY_SHARED_ARTIFACTS ?? '[]');
const { packCore } = require('../../../tests/packed-core.cjs');
let corePackage: { archive: string; dispose(): void };
beforeAll(() => { corePackage = packCore(); }, 120000);
afterAll(() => corePackage?.dispose());

const packageDirectory = join(__dirname, '..');
const fixtureDirectory = join(__dirname, 'fixtures', 'packed-host');
const npmCacheDirectory = mkdtempSync(join(tmpdir(), 'toggly-asyncstorage-npm-cache-'));

const hosts = [
  { asyncStorage: '1.24.0', react: '18.3.1', reactNative: '0.76.2', typesReact: '18.3.31' },
  { asyncStorage: '2.2.0', expo: '57.0.22', react: '19.2.3', reactNative: '0.86.3', typesReact: '19.1.1' },
  { asyncStorage: '3.1.1', react: '19.2.3', reactNative: '0.87.1', typesReact: '19.1.1' },
];

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCacheDirectory },
      stdio: 'pipe',
    });
  } catch (error: any) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`);
  }
}

describe('packed AsyncStorage hosts', () => {
  for (const host of hosts) {
    it(`installs, typechecks, and uses the default AsyncStorage API on ${host.asyncStorage}`, () => {
      run('npm', ['run', 'build'], packageDirectory);
      const packed = JSON.parse(run('npm', ['pack', '--json'], packageDirectory))[0];
      const tarball = join(packageDirectory, packed.filename);
      const hostDirectory = mkdtempSync(join(tmpdir(), `toggly-asyncstorage-${host.asyncStorage}-`));

      try {
        cpSync(fixtureDirectory, hostDirectory, { recursive: true });
        cpSync(join(packageDirectory, '..', '..', 'tests', 'telemetry-consumer.cjs'), join(hostDirectory, 'telemetry-consumer.cjs'));
        const packageJsonPath = join(hostDirectory, 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        Object.assign(packageJson.dependencies, {
          '@react-native-async-storage/async-storage': host.asyncStorage,
          '@types/react': host.typesReact,
          react: host.react,
          'react-native': host.reactNative,
          ...(host.expo ? { expo: host.expo } : {}),
        });
        writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

        run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball, ...sharedArtifacts, corePackage.archive], hostDirectory);
        run('npm', ['run', 'typecheck'], hostDirectory);
        run('npm', ['run', 'verify'], hostDirectory);
      } finally {
        rmSync(hostDirectory, { recursive: true, force: true });
        rmSync(tarball, { force: true });
      }
    }, 120000);
  }
});

afterAll(() => {
  rmSync(npmCacheDirectory, { recursive: true, force: true });
});
