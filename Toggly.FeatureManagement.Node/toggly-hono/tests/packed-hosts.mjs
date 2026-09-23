import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adapterDirectory = dirname(fileURLToPath(import.meta.url))
const workspaceDirectory = dirname(adapterDirectory)

function runPnpm(args, options = {}) {
  const execPath = process.env.npm_execpath
  if (execPath) {
    return run(process.execPath, [execPath, ...args], options)
  }
  return run('pnpm', args, options)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? workspaceDirectory,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      ...options.env,
    },
  })
}

function packAdapter() {
  const destination = mkdtempSync(join(tmpdir(), 'toggly-hono-pack-'))
  runPnpm(['pack', '--pack-destination', destination], { cwd: adapterDirectory })
  const [filename] = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  assert.ok(filename, 'pnpm pack produced an adapter tarball')
  return { destination, tarball: join(destination, filename) }
}

function writeHostFixture(directory) {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2))
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      strict: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['types.ts'],
  }, null, 2))
  writeFileSync(join(directory, 'types.ts'), `
import { Hono } from 'hono'
import { featureGate, togglyMiddleware, type TogglyHonoConfig } from '@ops-ai/toggly-hono'

const app = new Hono()
const config: TogglyHonoConfig = { appKey: 'typecheck', enableStreaming: false }
app.use('*', togglyMiddleware(config))
app.get('/gated', featureGate({ featureKey: 'feature-a' }), async (context) => {
  const enabled: boolean = await context.get('toggly').isFeatureOn('feature-a')
  return context.json({ enabled, identity: context.get('toggly').context.identity })
})
`)
  writeFileSync(join(directory, 'require.cjs'), `
const assert = require('node:assert/strict')
const adapter = require('@ops-ai/toggly-hono')
assert.equal(typeof adapter.togglyMiddleware, 'function')
assert.equal(typeof adapter.featureGate, 'function')
assert.equal(typeof adapter.closeHonoToggly, 'function')
`)
  writeFileSync(join(directory, 'host.mjs'), `
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {
  closeHonoToggly,
  featureGate,
  getHonoToggly,
  togglyMiddleware,
} from '@ops-ai/toggly-hono'

const state = {
  body: JSON.stringify({ defs: [
    { featureKey: 'enabled', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    { featureKey: 'disabled', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  ] }),
}
const definitions = createServer((request, response) => {
  assert.match(request.url, /^\\/definitions-signed\\/hono-host\\/Production/)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(state.body)
})
await new Promise((resolve) => definitions.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + definitions.address().port

async function createHost(options = {}) {
  const app = new Hono()
  app.use('*', togglyMiddleware({
    appKey: 'hono-host',
    baseUrl,
    environment: 'Production',
    enableStreaming: false,
    enableUsageTracking: false,
    enableMetrics: false,
    refreshInterval: 0,
    registerContextsOnStartup: false,
    ...options,
  }))
  app.get('/context', async (context) => context.json({
    identity: context.get('toggly').context.identity,
    country: context.get('toggly').context.request?.country,
    enabled: await context.get('toggly').isFeatureOn('enabled'),
  }))
  app.get('/enabled', featureGate({ featureKey: 'enabled' }), (context) => context.json({ ok: true }))
  app.get('/disabled', featureGate({ featureKey: 'disabled' }), (context) => context.json({ ok: true }))
  const host = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  await new Promise((resolve) => host.once('listening', resolve))
  return host
}

try {
  const host = await createHost()
  const origin = 'http://127.0.0.1:' + host.address().port
  try {
    const alice = await (await fetch(origin + '/context', { headers: { 'x-toggly-identity': 'alice', 'cf-ipcountry': 'US' } })).json()
    const bob = await (await fetch(origin + '/context', { headers: { 'x-toggly-identity': 'bob', 'cf-ipcountry': 'CA' } })).json()
    assert.deepEqual(alice, { identity: 'alice', country: 'US', enabled: true })
    assert.deepEqual(bob, { identity: 'bob', country: 'CA', enabled: true })
    assert.equal((await fetch(origin + '/enabled')).status, 200)
    assert.equal((await fetch(origin + '/disabled')).status, 404)

    state.body = JSON.stringify({ defs: [
      { featureKey: 'enabled', filters: [{ name: 'AlwaysOff', parameters: {} }] },
      { featureKey: 'disabled', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    ] })
    await getHonoToggly().refresh()
    assert.equal((await fetch(origin + '/enabled')).status, 404)
    assert.equal((await fetch(origin + '/disabled')).status, 200)

    state.body = '{'
    await getHonoToggly().refresh()
    assert.ok(getHonoToggly().state.error instanceof Error)
    assert.equal((await fetch(origin + '/disabled')).status, 200)
  } finally {
    closeHonoToggly()
    await new Promise((resolve) => host.close(resolve))
  }
  assert.equal(getHonoToggly(), null)

  state.body = JSON.stringify({ defs: [] })
  const signedHost = await createHost({ verifySignatures: true })
  try {
    const origin = 'http://127.0.0.1:' + signedHost.address().port
    assert.equal((await fetch(origin + '/enabled')).status, 404)
    assert.ok(getHonoToggly().state.error instanceof Error)
  } finally {
    closeHonoToggly()
    await new Promise((resolve) => signedHost.close(resolve))
  }
  assert.equal(getHonoToggly(), null)
  console.log('PACKED_HONO_HOST_PASS', JSON.stringify({ hono: process.env.HONO_VERSION, node: process.version }))
} finally {
  closeHonoToggly()
  await new Promise((resolve) => definitions.close(resolve))
}
`)
}

function verifyPackedFile(tarball) {
  const contents = run('tar', ['-tzf', tarball])
  for (const expected of ['package/dist/index.js', 'package/dist/index.cjs', 'package/dist/index.d.ts', 'package/README.md']) {
    assert.ok(contents.includes(expected), `packed adapter contains ${expected}`)
  }
  const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']))
  assert.equal(manifest.dependencies['@ops-ai/toggly-node-core'], '^0.10.0')
}

function packCore() {
  const destination = mkdtempSync(join(tmpdir(), 'toggly-node-core-pack-'))
  runPnpm(['pack', '--pack-destination', destination], { cwd: join(workspaceDirectory, '..', 'toggly-node-core') })
  const [filename] = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  assert.ok(filename, 'pnpm pack produced a core tarball')
  return { destination, tarball: join(destination, filename) }
}

function packEval() {
  const destination = mkdtempSync(join(tmpdir(), 'toggly-eval-pack-'))
  const evalDirectory = join(workspaceDirectory, '..', '..', 'toggly-eval')
  run('npm', ['pack', '--pack-destination', destination], { cwd: evalDirectory })
  const [filename] = readdirSync(destination).filter((name) => name.endsWith('.tgz'))
  assert.ok(filename, 'npm pack produced an eval tarball')
  return { destination, tarball: join(destination, filename) }
}

const packed = packAdapter()
const packedCore = packCore()
const packedEval = packEval()
const hostDirectory = mkdtempSync(join(tmpdir(), 'toggly-hono-host-'))
try {
  verifyPackedFile(packed.tarball)
  writeHostFixture(hostDirectory)
  run('npm', [
    'install', '--no-package-lock',
    'hono@4.13.7',
    '@hono/node-server@2.1.1',
    '@types/node@22.19.11',
    'typescript@5.9.3',
    packedCore.tarball,
    packedEval.tarball,
    packed.tarball,
  ], {
    cwd: hostDirectory,
    env: { npm_config_cache: join(hostDirectory, '.npm-cache') },
  })
  run(join(hostDirectory, 'node_modules', '.bin', 'tsc'), ['--noEmit'], { cwd: hostDirectory })
  run(process.execPath, ['require.cjs'], { cwd: hostDirectory })
  const output = run(process.execPath, ['host.mjs'], { cwd: hostDirectory, env: { HONO_VERSION: '4.13.7' } })
  assert.match(output, /PACKED_HONO_HOST_PASS.*4\.13\.7/)
  process.stdout.write(output)
} finally {
  rmSync(hostDirectory, { recursive: true, force: true })
  rmSync(packed.destination, { recursive: true, force: true })
  rmSync(packedCore.destination, { recursive: true, force: true })
  rmSync(packedEval.destination, { recursive: true, force: true })
}
