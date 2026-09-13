import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const adapterDirectory = dirname(packageDirectory)
const workspaceDirectory = dirname(adapterDirectory)
const node18 = process.env.TOGGLY_FASTIFY_NODE18 ?? process.execPath
const node20 = process.env.TOGGLY_FASTIFY_NODE20 ?? process.execPath

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? workspaceDirectory,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
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
  const destination = mkdtempSync(join(tmpdir(), 'toggly-fastify-pack-'))
  run('pnpm', ['pack', '--pack-destination', destination], { cwd: adapterDirectory })
  const [filename] = readdirSync(destination).filter(name => name.endsWith('.tgz'))
  assert.ok(filename, 'pnpm pack produced an adapter tarball')
  return { destination, tarball: join(destination, filename) }
}

function writeHostFixture(directory) {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    scripts: { typecheck: 'tsc --noEmit' },
  }, null, 2))
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
import Fastify from 'fastify'
import { featureGate, togglyPlugin } from '@ops-ai/toggly-fastify'

const app = Fastify()
await app.register(togglyPlugin, { appKey: 'typecheck', enableStreaming: false })
app.get('/gated', { preHandler: featureGate({ featureKey: 'feature-a' }) }, async request => {
  const enabled: boolean = await request.toggly!.isFeatureOn('feature-a')
  return { enabled, identity: request.toggly!.context.identity }
})
`)
  writeFileSync(join(directory, 'require.cjs'), `
const assert = require('node:assert/strict')
const adapter = require('@ops-ai/toggly-fastify')
assert.equal(typeof adapter.togglyPlugin, 'function')
assert.equal(typeof adapter.featureGate, 'function')
console.log('PACKED_FASTIFY_CJS_EXPORTS_PASS')
`)
  writeFileSync(join(directory, 'host.mjs'), `
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import Fastify from 'fastify'
import {
  closeFastifyToggly,
  featureGate,
  getFastifyToggly,
  togglyPlugin,
} from '@ops-ai/toggly-fastify'

const state = {
  body: JSON.stringify({
    defs: [
      { featureKey: 'feature-a', filters: [{ name: 'AlwaysOn', parameters: {} }] },
      { featureKey: 'feature-b', filters: [{ name: 'AlwaysOff', parameters: {} }] },
    ],
  }),
}
const definitions = createServer((request, response) => {
  assert.match(request.url, /^\\/definitions-signed\\/fastify-host\\/Production/)
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(state.body)
})
await new Promise(resolve => definitions.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + definitions.address().port

async function createApp(options = {}) {
  const app = Fastify()
  await app.register(togglyPlugin, {
    appKey: 'fastify-host',
    baseUrl,
    environment: 'Production',
    enableStreaming: false,
    enableUsageTracking: false,
    enableMetrics: false,
    refreshInterval: 0,
    registerContextsOnStartup: false,
    ...options,
  })
  app.get('/context', async request => ({
    identity: request.toggly?.context.identity,
    country: request.toggly?.context.request?.country,
    featureA: await request.toggly?.isFeatureOn('feature-a'),
  }))
  app.get('/gated', { preHandler: featureGate({ featureKey: 'feature-a' }) }, async () => ({ ok: true }))
  app.get('/disabled', { preHandler: featureGate({ featureKey: 'feature-b' }) }, async () => ({ ok: true }))
  await app.listen({ port: 0, host: '127.0.0.1' })
  return app
}

try {
  const app = await createApp()
  try {
    const first = await (await fetch(app.listeningOrigin + '/context', {
      headers: { 'x-toggly-identity': 'alice', 'cf-ipcountry': 'US' },
    })).json()
    const second = await (await fetch(app.listeningOrigin + '/context', {
      headers: { 'x-toggly-identity': 'bob', 'cf-ipcountry': 'CA' },
    })).json()
    assert.deepEqual(first, { identity: 'alice', country: 'US', featureA: true })
    assert.deepEqual(second, { identity: 'bob', country: 'CA', featureA: true })
    assert.equal((await fetch(app.listeningOrigin + '/gated')).status, 200)
    assert.equal((await fetch(app.listeningOrigin + '/disabled')).status, 404)

    state.body = JSON.stringify({
      defs: [
        { featureKey: 'feature-a', filters: [{ name: 'AlwaysOff', parameters: {} }] },
        { featureKey: 'feature-b', filters: [{ name: 'AlwaysOn', parameters: {} }] },
      ],
    })
    await getFastifyToggly().refresh()
    assert.equal((await fetch(app.listeningOrigin + '/gated')).status, 404)
    assert.equal((await fetch(app.listeningOrigin + '/disabled')).status, 200)

    state.body = '{'
    await getFastifyToggly().refresh()
    assert.ok(getFastifyToggly().state.error instanceof Error)
    assert.equal((await fetch(app.listeningOrigin + '/disabled')).status, 200)
  } finally {
    await app.close()
  }
  assert.equal(getFastifyToggly(), null)

  state.body = JSON.stringify({ defs: [] })
  const signedApp = await createApp({ verifySignatures: true })
  try {
    assert.ok(getFastifyToggly().state.error instanceof Error)
    assert.equal((await fetch(signedApp.listeningOrigin + '/gated')).status, 404)
  } finally {
    await signedApp.close()
  }
  assert.equal(getFastifyToggly(), null)
  console.log('PACKED_FASTIFY_HOST_PASS', JSON.stringify({ fastify: process.env.FASTIFY_VERSION, node: process.version }))
} finally {
  closeFastifyToggly()
  await new Promise(resolve => definitions.close(resolve))
}
`)
}

function verifyPackedFile(tarball) {
  const contents = run('tar', ['-tzf', tarball])
  for (const expected of ['package/dist/index.js', 'package/dist/index.cjs', 'package/dist/index.d.ts', 'package/README.md']) {
    assert.ok(contents.includes(expected), `packed adapter contains ${expected}`)
  }
  const manifest = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json']))
  assert.equal(manifest.dependencies['@ops-ai/toggly-node-core'], '^0.9.1')
}

function nodeMajor(node) {
  return Number(run(node, ['-p', "process.versions.node.split('.')[0]"]).trim())
}

const packed = packAdapter()
const { tarball } = packed
const hostDirectory = mkdtempSync(join(tmpdir(), 'toggly-fastify-host-'))
try {
  verifyPackedFile(tarball)
  writeHostFixture(hostDirectory)

  for (const host of [
    { fastify: '4.29.1', node: node18, minimumNode: 18 },
    { fastify: '5.12.4', node: node20, minimumNode: 20 },
  ]) {
    assert.ok(
      nodeMajor(host.node) >= host.minimumNode,
      `Fastify ${host.fastify} requires Node ${host.minimumNode}+; configure a valid host binary`
    )
    run('npm', [
      'install', '--no-package-lock',
      `fastify@${host.fastify}`,
      'typescript@5.9.3',
      '@types/node@22.19.11',
      tarball,
    ], { cwd: hostDirectory })
    run(join(hostDirectory, 'node_modules', '.bin', 'tsc'), ['--noEmit'], { cwd: hostDirectory })
    run(host.node, ['require.cjs'], { cwd: hostDirectory })
    const output = run(host.node, ['host.mjs'], {
      cwd: hostDirectory,
      env: { FASTIFY_VERSION: host.fastify },
    })
    assert.match(output, new RegExp(`PACKED_FASTIFY_HOST_PASS.*${host.fastify}`))
    process.stdout.write(output)
  }
} finally {
  rmSync(hostDirectory, { recursive: true, force: true })
  rmSync(packed.destination, { recursive: true, force: true })
}
