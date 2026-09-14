import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageDirectory = join(__dirname, '..');
const corePackageDirectory = join(packageDirectory, '..', 'core');
const fixtureDirectory = join(__dirname, 'fixtures', 'packed-host');

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    const result = error as { stderr?: string; stdout?: string };
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
}

describe('packed legacy MMKV hosts', () => {
  beforeAll(() => {
    run('npm', ['ci'], corePackageDirectory);
    run('npm', ['run', 'build'], corePackageDirectory);
  }, 120000);

  for (const mmkvVersion of ['2.12.2', '3.3.3']) {
    it(`installs, typechecks, and runs with MMKV ${mmkvVersion}`, () => {
      run('npm', ['run', 'build'], packageDirectory);
      const packed = JSON.parse(run('npm', ['pack', '--json'], packageDirectory))[0];
      const tarball = join(packageDirectory, packed.filename);
      const hostDirectory = mkdtempSync(join(tmpdir(), `toggly-mmkv-${mmkvVersion}-host-`));

      try {
        cpSync(fixtureDirectory, hostDirectory, { recursive: true });
        const hostPackage = JSON.parse(readFileSync(join(hostDirectory, 'package.json'), 'utf8'));
        hostPackage.dependencies['react-native-mmkv'] = mmkvVersion;
        writeFileSync(join(hostDirectory, 'package.json'), JSON.stringify(hostPackage, null, 2));

        run(
          'npm',
          ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball],
          hostDirectory
        );
        run('npm', ['run', 'typecheck'], hostDirectory);
        run('npm', ['run', 'verify'], hostDirectory);
      } finally {
        rmSync(hostDirectory, { recursive: true, force: true });
        rmSync(tarball, { force: true });
      }
    }, 120000);
  }
});
