import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const probe = mkdtempSync(join(tmpdir(), 'toggly-local-gates-types-'))

const source = `import { buildFlagGateIndex } from '@ops-ai/toggly-local-gates';
const check: typeof buildFlagGateIndex = buildFlagGateIndex;
void check;
`

try {
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', probe], {
    cwd: pkgRoot,
    encoding: 'utf8',
  }).trim()

  writeFileSync(join(probe, 'package.json'), JSON.stringify({
    name: 'consumer-probe',
    private: true,
    type: 'module',
    devDependencies: { typescript: '^5.8.0' },
  }, null, 2))

  writeFileSync(join(probe, 'consumer.mts'), source)
  writeFileSync(join(probe, 'consumer.cts'), source)

  execFileSync('npm', ['install', '--silent', join(probe, tarball)], { cwd: probe, stdio: 'inherit' })
  execFileSync('npm', ['install', '--silent'], { cwd: probe, stdio: 'inherit' })

  const tsc = join(probe, 'node_modules', '.bin', 'tsc')
  const args = ['--noEmit', '--strict', '--module', 'Node16', '--moduleResolution', 'Node16', '--target', 'ES2020']

  execFileSync(tsc, [...args, 'consumer.mts'], { cwd: probe, stdio: 'inherit' })
  execFileSync(tsc, [...args, 'consumer.cts'], { cwd: probe, stdio: 'inherit' })

  console.log('Consumer TypeScript resolution verified for .mts and .cts')
} finally {
  rmSync(probe, { recursive: true, force: true })
}
