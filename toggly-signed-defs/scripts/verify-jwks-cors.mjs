import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixture = JSON.parse(
  await readFile(new URL('../testdata/webcrypto-fixture.json', import.meta.url))
)
const envelope = `{"defs":${fixture.defs},"timestamp":${fixture.timestamp},"signature":"${fixture.signature}","kid":"${fixture.kid}"}`
const requests = []
let browser
let browserServer
let browserProcess
const servers = []

async function listen(handler) {
  const server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      response.writeHead(500)
      response.end()
    })
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${server.address().port}`
}

async function bounded(work, milliseconds) {
  let timer
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Browser cleanup timeout')), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

try {
  const appOrigin = await listen(async (request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>JWKS CORS regression</title>')
      return
    }
    if (!request.url.startsWith('/dist/')) {
      response.writeHead(404)
      response.end()
      return
    }
    // Serve only built browser modules from this package, with actual HTTP imports.
    const name = basename(request.url)
    assert.match(name, /^[a-z-]+\.js$/)
    response.setHeader('Content-Type', 'text/javascript')
    response.end(await readFile(new URL(`../dist/browser/${name}`, import.meta.url)))
  })
  const definitionsOrigin = await listen(async (request, response) => {
    requests.push({ path: request.url, method: request.method, headers: request.headers })
    response.setHeader('Access-Control-Allow-Origin', appOrigin)
    response.setHeader('Access-Control-Expose-Headers', 'X-Definitions-Revision')
    if (request.url === '/.well-known/jwks') {
      // Public JWKS intentionally permits simple GET only. A forwarded SDK header
      // triggers a real browser preflight, which this response does not authorize.
      response.setHeader('Content-Type', 'application/json')
      response.end(request.method === 'OPTIONS' ? '' : JSON.stringify(fixture.jwks))
      return
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET')
      response.setHeader(
        'Access-Control-Allow-Headers',
        'X-Toggly-Sdk, X-Toggly-Sdk-Version, If-None-Match'
      )
      response.writeHead(204)
      response.end()
      return
    }
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('X-Definitions-Revision', 'verified-revision')
    response.end(
      request.url === '/corrupt'
        ? envelope.replace('"enabled": true', '"enabled": false')
        : envelope
    )
  })
  const driverPath = process.env.PLAYWRIGHT_MODULE_PATH
  assert.ok(
    driverPath && isAbsolute(driverPath),
    'Set PLAYWRIGHT_MODULE_PATH to installed Playwright index.mjs'
  )
  const { chromium } = await import(pathToFileURL(driverPath).href)
  browserServer = await chromium.launchServer({ headless: true, host: '127.0.0.1' })
  browserProcess = browserServer.process()
  browser = await chromium.connect(browserServer.wsEndpoint())
  const page = await browser.newPage()
  await page.goto(appOrigin)
  const result = await page.evaluate(async (baseURI) => {
    const { InMemoryJwksCache, fetchEvaluatedSignedDefinitions } = await import('/dist/index.js')
    const cache = new InMemoryJwksCache()
    const config = { verifySignatures: true, baseURI }
    const request = {
      headers: { 'X-Toggly-Sdk': 'solidjs', 'X-Toggly-Sdk-Version': '0.2.0' },
      revision: 'previous-revision',
    }
    try {
      const accepted = await fetchEvaluatedSignedDefinitions(
        `${baseURI}/evaluated`,
        cache,
        config,
        request
      )
      await fetchEvaluatedSignedDefinitions(`${baseURI}/evaluated`, cache, config, request)
      let corruptRejected = false
      try {
        await fetchEvaluatedSignedDefinitions(`${baseURI}/corrupt`, cache, config, request)
      } catch {
        corruptRejected = true
      }
      return { accepted, corruptRejected }
    } catch (error) {
      return { error: error.message }
    }
  }, definitionsOrigin)
  assert.equal(
    result.error,
    undefined,
    JSON.stringify({ result, jwksRequests: requests.filter((r) => r.path === '/.well-known/jwks') })
  )
  assert.deepEqual(result.accepted, {
    notModified: false,
    defs: JSON.parse(fixture.defs),
    revision: 'verified-revision',
  })
  assert.equal(result.corruptRejected, true)
  const jwks = requests.filter((request) => request.path === '/.well-known/jwks')
  assert.deepEqual(
    jwks.map((request) => request.method),
    ['GET']
  )
  assert.equal(jwks[0].headers['x-toggly-sdk'], undefined)
  assert.equal(jwks[0].headers['x-toggly-sdk-version'], undefined)
  const evaluated = requests.filter(
    (request) => request.path === '/evaluated' && request.method === 'GET'
  )
  assert.equal(evaluated.length, 2)
  for (const request of evaluated) {
    assert.equal(request.headers['x-toggly-sdk'], 'solidjs')
    assert.equal(request.headers['x-toggly-sdk-version'], '0.2.0')
    assert.equal(request.headers['if-none-match'], 'previous-revision')
  }
  console.log(
    'Real Chromium CORS: verified definitions, header-free cached JWKS, and corrupt signature rejection passed.'
  )
} finally {
  try {
    const results = await bounded(
      Promise.allSettled([browser?.close(), browserServer?.close()]),
      5000
    )
    assert.ok(results.every((result) => result.status === 'fulfilled'))
  } catch (error) {
    if (browserProcess && browserProcess.exitCode === null && browserProcess.signalCode === null) {
      const exited = once(browserProcess, 'exit')
      browserProcess.kill('SIGKILL')
      await bounded(exited, 5000)
    }
    throw error
  } finally {
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
}
