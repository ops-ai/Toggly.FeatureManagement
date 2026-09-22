import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bounded, withResources, closeServer, stopChild, launchBrowser, readHttp } from './owned-resources.mjs'

export async function verifyRuntimePolicy(work, chromium, telemetryRequests) {
  // Guard Nitro as well as the browser. A future regression must fail locally,
  // not connect a newly enabled trusted transport to production.
  const guard = join(work, 'runtime-policy-network-guard.mjs')
  const rejected = join(work, 'runtime-policy-rejected.log')
  await writeFile(guard, `import http2 from 'node:http2';
import {appendFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const check=value=>{const url=new URL(String(value));if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)){appendFileSync(process.env.NUXT_POLICY_REJECTED,url.origin+'\\n');throw Error('Policy fixture blocked non-loopback request')}};
const fetch=globalThis.fetch;globalThis.fetch=(input,...args)=>{check(input.url??input);return fetch(input,...args)};
const connect=http2.connect;http2.connect=(url,...args)=>{check(url);return connect(url,...args)};syncBuiltinESMExports();
`)
  await withResources(async own => {
    const definitions = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', '*')
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'OPTIONS') return res.end()
      const url = new URL(req.url, 'http://localhost')
      const local = url.pathname.includes('/definitions-signed/')
      res.end(JSON.stringify(local ? [
        { featureKey: 'Enabled', filters: [{ name: 'AlwaysOn', parameters: {} }] },
        { featureKey: 'Disabled', filters: [] },
        { featureKey: 'Targeted', filters: [{ name: 'Targeting', parameters: { 'Audience.Users:0': 'alice' } }] },
      ] : { Enabled: true, Disabled: false, Targeted: url.searchParams.get('u') === 'alice', Automatic: true }))
    })
    own(() => closeServer(definitions))
    await new Promise(resolve => definitions.listen(0, '127.0.0.1', resolve))
    const baseUri = `http://127.0.0.1:${definitions.address().port}`
    for (const enabled of [true, false]) await withResources(async ownHost => {
      const probe = createServer()
      await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
      const port = probe.address().port
      await new Promise(resolve => probe.close(resolve))
      const start = telemetryRequests.length
      const host = spawn(process.execPath, ['--import', guard, '.output/server/index.mjs'], {
        cwd: work, stdio: 'inherit', env: {
          ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1',
          TOGGLY_DISABLE_TELEMETRY: '', NUXT_TEST_MODULE_POLICY: '1', NUXT_POLICY_REJECTED: rejected,
          NUXT_PUBLIC_TOGGLY_APP_KEY: 'policy-fixture', NUXT_PUBLIC_TOGGLY_BASE_URI: baseUri,
          NUXT_PUBLIC_TOGGLY_ENABLE_TELEMETRY: String(enabled),
        },
      })
      ownHost(() => stopChild(host))
      const url = `http://127.0.0.1:${port}`
      let response
      for (let i = 0; i < 100; i++) {
        if (host.exitCode !== null) throw Error('Runtime policy host exited before startup')
        try { response = await readHttp(url, {}, 1000); if (response.ok) break } catch {}
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert(response?.ok, 'module-owned Nitro host starts')
      assert.match(response.body, /id="gate"/, 'server policy does not disable SSR enabled branch')
      const policy = JSON.parse((await readHttp(url + '/api/runtime-policy')).body)
      assert.deepEqual(policy, { policy: { usage: false, metrics: false, usageSender: false, metricsSender: false }, enabled: true })
      assert.equal(telemetryRequests.length, start, 'SSR and explicit Nitro events produce no frontend transport')
      const browser = await launchBrowser(chromium, ownHost)
      const page = await browser.newPage()
      const outbound = []
      await page.route('**/*', route => {
        const target = new URL(route.request().url())
        if (target.hostname !== '127.0.0.1') { outbound.push(target.origin); return route.abort() }
        return route.continue()
      })
      await page.goto(url)
      await page.waitForFunction(() => document.querySelector('#mounted')?.textContent === 'true' && document.querySelector('#automatic')?.textContent === 'true')
      await bounded(() => page.evaluate(() => window.runtimePolicyFlush()), 'policy baseline flush', 10000)
      const actionStart = telemetryRequests.length
      await bounded(() => page.evaluate(() => window.runtimePolicyTelemetry()), 'policy explicit browser telemetry', 10000)
      const packets = telemetryRequests.slice(actionStart).filter(request => request.payload)
      if (enabled) {
        assert.equal(packets.length, 1)
        assert.equal(packets[0].payload.k, 'policy-fixture')
        assert.deepEqual(packets[0].payload.f, { Enabled: { enabled: [1], blue: [0, 1], green: [0, 0, 1] } })
        assert.deepEqual(packets[0].payload.m, { 'fixture-counter': 2, 'fixture-gauge': 3 })
      } else assert.equal(telemetryRequests.length, start, 'browser opt-out stays silent too')
      assert.deepEqual(outbound, [])
      assert.equal(await readFile(rejected, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error }), '', 'Nitro made no external transport attempt')
      console.log(`PASS module runtime policy: server categories disabled, SSR enabled result, browser reporting=${enabled}`)
    })
  })
}
