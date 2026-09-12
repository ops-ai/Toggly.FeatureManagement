import assert from 'node:assert/strict'
import dns from 'node:dns'
import { createServer } from 'node:http'
import http2 from 'node:http2'
import { syncBuiltinESMExports } from 'node:module'
import tls from 'node:tls'
import Koa from 'koa'

// This child fixture needs only numeric loopback HTTP. Reject telemetry's
// DNS/TLS/HTTP2 attempts before they can reach production, even if the SDK
// catches the transport error or starts an asynchronous flush during close.
const unexpectedConnections = []
function rejectConnection(transport) {
  return () => {
    unexpectedConnections.push(transport)
    throw new Error(`Unexpected ${transport} connection in local Koa fixture`)
  }
}
function loopbackLookup(lookup) {
  return (hostname, ...args) => {
    if (hostname === '127.0.0.1' || hostname === '::1') return lookup(hostname, ...args)
    return rejectConnection('DNS')()
  }
}
dns.lookup = loopbackLookup(dns.lookup.bind(dns))
dns.promises.lookup = loopbackLookup(dns.promises.lookup.bind(dns.promises))
dns.promises.resolveTxt = rejectConnection('DNS TXT')
http2.connect = rejectConnection('HTTP2')
tls.connect = rejectConnection('TLS')
syncBuiltinESMExports()
process.on('beforeExit', () => {
  assert.deepEqual(unexpectedConnections, [], 'No external transport attempts, including shutdown')
})

const { closeKoaToggly, featureGate, getKoaToggly, togglyMiddleware } =
  await import('@ops-ai/toggly-koa')

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
app.use(togglyMiddleware({
  appKey: 'packed-host',
  baseUrl,
  refreshInterval: 0,
  enableUsageTracking: false,
  enableMetrics: false,
}))
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
      enableUsageTracking: false,
      enableMetrics: false,
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
