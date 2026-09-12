import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  const fixture = JSON.parse(readFileSync(join(packageRoot, 'testdata/webcrypto-fixture.json'), 'utf8'))
  const derCases = JSON.parse(readFileSync(join(packageRoot, 'testdata/der-signatures.json'), 'utf8'))
  const assertions = `
const fixture = ${JSON.stringify(fixture)}
const derCases = ${JSON.stringify(derCases)}
async function check() {
  assert.equal(await m.computeKid('AA', 'AA'), '1489F923C4DCA729178B3E3233458550D8DDDF29ES256')
  await m.verifySignedDefinitions(fixture.defs, fixture, fixture.jwks)
  await m.verifySignedDefinitions(fixture.defs, { ...fixture, signature: derCases.valid }, fixture.jwks)
  for (const [name, signature] of Object.entries(derCases.invalid)) {
    await assert.rejects(m.verifySignedDefinitions(fixture.defs, { ...fixture, signature }, fixture.jwks), undefined, name)
  }
  console.log(process.version + ': KID, P1363, DER and malformed signature checks passed')
}
check().catch(error => { console.error(error); process.exitCode = 1 })
`
  writeFileSync(join(probe, 'runtime.mjs'), `import * as m from '@ops-ai/toggly-signed-defs'\nimport assert from 'node:assert/strict'\n${assertions}`)
  writeFileSync(join(probe, 'runtime.cjs'), `const m = require('@ops-ai/toggly-signed-defs')\nconst assert = require('node:assert/strict')\n${assertions}`)
  let failures = 0
  function checkRuntime(runtime, args) {
    try { run(runtime, args, { cwd: probe }) } catch { failures += 1 }
  }
  for (const runtime of [...process.argv.slice(2), process.execPath]) {
    checkRuntime(runtime, ['runtime.cjs'])
    checkRuntime(runtime, ['runtime.mjs'])
  }
  writeFileSync(join(probe, 'browser-runtime.mjs'), `import * as m from '@ops-ai/toggly-signed-defs'\nimport assert from 'node:assert/strict'\nglobalThis.Buffer = undefined\n${assertions}`)
  checkRuntime(process.execPath, ['--conditions=browser', 'browser-runtime.mjs'])
  if (failures) throw new Error(`${failures} packed runtime consumers failed`)

  console.log('Packed artifact resolves through browser, ESM, and CJS consumers with TypeScript declarations.')
} finally {
  rmSync(probe, { recursive: true, force: true })
}
