import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const probe = mkdtempSync(join(tmpdir(), 'toggly-signed-defs-consumer-'))
const npmCache = join(probe, '.npm-cache')

const esmConsumer = `import {
  computeKid,
  parseSignedEnvelope,
  type JwkSet,
} from '@ops-ai/toggly-signed-defs'

const jwks: JwkSet = { keys: [] }
void jwks
void computeKid
parseSignedEnvelope('{"signature":"s","timestamp":1,"kid":"k","defs":{}}')
`

const cjsConsumer = `import signedDefs = require('@ops-ai/toggly-signed-defs')

const parser: typeof signedDefs.parseSignedEnvelope = signedDefs.parseSignedEnvelope
void parser
`

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: npmCache },
    ...options,
  })
}

try {
  const tarball = execFileSync(
    'npm',
    ['pack', '--silent', '--pack-destination', probe],
    { cwd: packageRoot, encoding: 'utf8', env: { ...process.env, npm_config_cache: npmCache } },
  ).trim()

  writeFileSync(
    join(probe, 'package.json'),
    `${JSON.stringify({ name: 'signed-defs-consumer-probe', private: true, type: 'module' }, null, 2)}\n`,
  )
  writeFileSync(join(probe, 'consumer.mts'), esmConsumer)
  writeFileSync(join(probe, 'consumer.cts'), cjsConsumer)
  writeFileSync(join(probe, 'browser-consumer.mts'), esmConsumer)

  run('npm', ['install', '--silent', '--no-audit', '--no-fund', join(probe, tarball)], { cwd: probe })

  const tsc = join(packageRoot, 'node_modules', '.bin', 'tsc')
  const commonArgs = [
    '--noEmit',
    '--strict',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2020',
  ]
  run(tsc, [...commonArgs, 'consumer.mts'], { cwd: probe })
  run(tsc, [...commonArgs, 'consumer.cts'], { cwd: probe })
  run(tsc, [...commonArgs, '--customConditions', 'browser', 'browser-consumer.mts'], { cwd: probe })

  run(
    'node',
    ['--conditions=browser', '--input-type=module', '-e', "const m = await import('@ops-ai/toggly-signed-defs'); if (typeof m.parseSignedEnvelope !== 'function') process.exit(1)"],
    { cwd: probe },
  )
  run(
    'node',
    ['--input-type=module', '-e', "const m = await import('@ops-ai/toggly-signed-defs'); if (typeof m.verifySignedDefinitions !== 'function') process.exit(1)"],
    { cwd: probe },
  )
  run(
    'node',
    ['-e', "const m = require('@ops-ai/toggly-signed-defs'); if (typeof m.verifySignedDefinitions !== 'function') process.exit(1)"],
    { cwd: probe },
  )

  console.log('Packed artifact resolves through browser, ESM, and CJS consumers with TypeScript declarations.')
} finally {
  rmSync(probe, { recursive: true, force: true })
}
