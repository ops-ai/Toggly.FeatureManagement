import {withResources,closeServer,stopChild,launchBrowser} from './owned-resources.mjs'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

// A second, configured production host exercises the real app:mounted hook.
// Definitions and browser traffic stay on loopback; no production credentials.
export async function verifyAutomaticStartup(work, chromium) {
 return withResources(async own=>{
  const requests = []
  const definitions = createServer((req, res) => {
    requests.push(req.url)
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'OPTIONS') { res.end(); return }
    const identity = new URL(req.url, 'http://localhost').searchParams.get('u')
    res.end(JSON.stringify({ Enabled: identity !== 'bob', Disabled: false, Targeted: identity === 'alice', Automatic: true }))
  })
  own(()=>closeServer(definitions))
  await new Promise(resolve => definitions.listen(0, '127.0.0.1', resolve))
  const baseUri = `http://127.0.0.1:${definitions.address().port}`
  const portProbe = createServer()
  own(()=>closeServer(portProbe))
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve))
  const port = portProbe.address().port
  await new Promise(resolve => portProbe.close(resolve))
  const host = spawn(process.execPath, ['.output/server/index.mjs'], {
    cwd: work, stdio: 'inherit', env: {
      ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1',
      TOGGLY_DISABLE_TELEMETRY: '1',
      NUXT_PUBLIC_TOGGLY_APP_KEY: 'local-fixture', NUXT_PUBLIC_TOGGLY_BASE_URI: baseUri,
    },
  })
  own(()=>stopChild(host))
  let browser
  const url = `http://127.0.0.1:${port}`
  {
    let response
    for (let i = 0; i < 100; i++) {
      if (host.exitCode !== null || host.signalCode !== null) throw new Error('configured host exited before startup')
      try { response = await fetch(url); if (response.ok) break } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(response?.ok, 'configured production host starts')
    browser = await launchBrowser(chromium,own)
    const page = await browser.newPage({ extraHTTPHeaders: { 'x-toggly-identity': 'alice' } })
    const errors = []
    const outbound = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (/hydration|mismatch/i.test(message.text())) errors.push(message.text()) })
    await page.route('**/*', route => {
      const target = new URL(route.request().url())
      if (target.hostname !== '127.0.0.1') { outbound.push(target.origin); return route.abort() }
      return route.continue()
    })
    // Hold the real startup response until hydration is observed, not a delay.
    let release
    const responseGate = new Promise(resolve => { release = resolve })
    const startup = page.waitForRequest(request => request.url().startsWith(baseUri) && request.method() === 'GET')
    await page.route(`${baseUri}/**`, async route => {
      if (route.request().method() === 'GET') { await responseGate }
      await route.continue()
    })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await startup
    await page.waitForFunction(() => document.querySelector('#mounted')?.textContent === 'true')
    assert.equal(await page.locator('#target').textContent(), 'true', 'server snapshot survives hydration while startup is pending')
    assert.equal(await page.locator('#core-target').textContent(), 'true')
    assert.equal(await page.locator('#automatic').textContent(), '', 'automatic response has not applied early')
    release()
    await page.waitForFunction(() => document.querySelector('#automatic')?.textContent === 'true')
    assert.equal(await page.locator('#initialized').textContent(), 'false', 'manual initialization was not invoked')
    assert.equal(requests.filter(path => path.includes('u=alice')).length, 1, 'exactly one automatic request uses hydrated identity')
    await page.locator('#identity').click()
    await page.waitForFunction(() => document.querySelector('#core-target')?.textContent === 'false')
    assert.equal(await page.locator('#flag').textContent(), 'false')
    assert.equal(await page.locator('#core-gate').textContent(), 'false')
    assert.equal(await page.locator('#gate').count(), 0)
    const refreshed = page.waitForResponse(response => response.url().startsWith(baseUri) && response.request().method() === 'GET')
    await page.locator('#refresh').click()
    await refreshed
    assert.deepEqual(errors, [])
    assert.deepEqual(outbound, [], 'no browser production request attempts')
    console.log('PASS configured automatic startup: held hydration, one identity request, remote update, identity, refresh, no production browser traffic')
  }
 })
}
