import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import Koa from 'koa'
import { closeKoaToggly, featureGate, getKoaToggly, togglyMiddleware } from '@ops-ai/toggly-koa'

let definitions = [
  { featureKey: 'enabled', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'disabled', filters: [{ name: 'AlwaysOff', parameters: {} }] },
]
let invalidSignature = false

const definitionsServer = createServer((request, response) => {
  if (request.url?.startsWith('/definitions-signed/')) {
    response.setHeader('content-type', 'application/json')
    response.end(
      invalidSignature
        ? JSON.stringify({ defs: definitions, signature: '', timestamp: 1, kid: 'invalid' })
        : JSON.stringify(definitions)
    )
    return
  }

  response.statusCode = 404
  response.end()
})

await new Promise((resolve) => definitionsServer.listen(0, '127.0.0.1', resolve))
const { port } = definitionsServer.address()
const baseUrl = `http://127.0.0.1:${port}`

const app = new Koa()
app.use(togglyMiddleware({ appKey: 'packed-host', baseUrl, refreshInterval: 0 }))
app.use(async (ctx, next) => {
  if (ctx.path === '/identity') {
    ctx.body = { identity: ctx.state.toggly.identity }
    return
  }
  await next()
})
app.use(featureGate({ featureKey: 'enabled' }))
app.use((ctx) => {
  ctx.body = { enabled: true, identity: ctx.state.toggly.identity }
})

const host = createServer(app.callback())
await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve))
const hostPort = host.address().port

try {
  const [alice, bob] = await Promise.all([
    fetch(`http://127.0.0.1:${hostPort}/identity`, { headers: { 'x-toggly-identity': 'alice' } }),
    fetch(`http://127.0.0.1:${hostPort}/identity`, { headers: { 'x-toggly-identity': 'bob' } }),
  ])
  assert.deepEqual(await alice.json(), { identity: 'alice' })
  assert.deepEqual(await bob.json(), { identity: 'bob' })

  const enabled = await fetch(`http://127.0.0.1:${hostPort}/enabled`)
  assert.equal(enabled.status, 200)

  definitions = [{ featureKey: 'enabled', filters: [{ name: 'AlwaysOff', parameters: {} }] }]
  await getKoaToggly().refresh()
  const refreshed = await fetch(`http://127.0.0.1:${hostPort}/enabled`)
  assert.equal(refreshed.status, 404)

  closeKoaToggly()
  invalidSignature = true
  const signatureErrors = []
  const invalidSignatureApp = new Koa()
  invalidSignatureApp.use(
    togglyMiddleware({
      appKey: 'packed-host',
      baseUrl,
      refreshInterval: 0,
      verifySignatures: true,
      onError: (error) => signatureErrors.push(error.message),
    })
  )
  invalidSignatureApp.use(featureGate({ featureKey: 'enabled' }))
  invalidSignatureApp.use((ctx) => {
    ctx.body = { enabled: true }
  })
  const invalidSignatureHost = createServer(invalidSignatureApp.callback())
  await new Promise((resolve) => invalidSignatureHost.listen(0, '127.0.0.1', resolve))
  try {
    const rejected = await fetch(`http://127.0.0.1:${invalidSignatureHost.address().port}/enabled`)
    assert.equal(rejected.status, 404)
    assert.match(signatureErrors.join('\n'), /Invalid signed definitions envelope/)
  } finally {
    closeKoaToggly()
    await new Promise((resolve) => invalidSignatureHost.close(resolve))
  }
} finally {
  closeKoaToggly()
  await new Promise((resolve) => host.close(resolve))
  await new Promise((resolve) => definitionsServer.close(resolve))
}
