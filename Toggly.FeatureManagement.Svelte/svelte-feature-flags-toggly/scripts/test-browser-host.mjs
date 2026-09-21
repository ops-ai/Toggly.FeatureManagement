import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const telemetryArchive = process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL

const chrome = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome')
// An x64 Node process under Rosetta otherwise launches the unsupported x64
// Chromium slice. Keep the Node host version while using the machine's browser.
const translated = process.platform === 'darwin' && process.arch === 'x64' &&
  spawnSync('/usr/sbin/sysctl', ['-in', 'sysctl.proc_translated'], { encoding: 'utf8' }).stdout?.trim() === '1'
const browser = translated ? '/usr/bin/arch' : chrome
const browserPrefix = translated ? ['-arm64', chrome] : []
const hosts = ['svelte-4-minimum', 'svelte-4', 'svelte-5']
const temporary = await mkdtemp(join(tmpdir(), 'toggly-svelte-browser-host-'))

function run(command, args, cwd, capture = false, finishMarker) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: !!finishMarker && process.platform !== 'win32', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    let stdout = ''
    let stderr = ''
    let markerSeen = false
    let timedOut = false
    let killTimer
    const signal = value => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, value)
        else child.kill(value)
      } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    const stop = () => {
      signal('SIGTERM')
      killTimer ??= setTimeout(() => signal('SIGKILL'), 2000)
    }
    const timeout = finishMarker ? setTimeout(() => { timedOut = true; stop() }, 30000) : undefined
    child.stdout?.on('data', chunk => {
      stdout += chunk
      if (finishMarker && !markerSeen && stdout.includes(finishMarker)) {
        markerSeen = true
        stop()
      }
    })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      if (timeout) clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      reject(error)
    })
    child.on('close', code => {
      if (timeout) clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      if (finishMarker && (timedOut || !markerSeen)) {
        reject(new Error(`${command} did not reach ${finishMarker}\n${stdout}\n${stderr}`))
        return
      }
      ;(code === 0 || markerSeen)
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`))
    })
  })
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise(resolve => server.close(resolve))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

function appSource(collector, label) {
  return `<script lang="ts">
  import { onMount } from 'svelte'
  import {
    Toggly, Feature, createToggly, flushTelemetry, getTogglyService,
    incrementCounter, recordUsage, recordView, setGauge,
  } from '@ops-ai/svelte-feature-flags-toggly'

  let state = 'running'
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  onMount(async () => {
    try {
      await createToggly({
        appKey: '${label}-one', environment: 'One', identity: 'alice', baseURI: '${collector}',
        metricsBaseUrl: '${collector}/metrics', enableLiveUpdates: false, persistCache: false,
      })
      await pause(50)
      recordUsage('Manual', 'blue')
      recordView('Manual', 'green')
      incrementCounter('orders', 2)
      setGauge('active', 5)
      await flushTelemetry()

      recordUsage('OldPending')
      await createToggly({
        appKey: '${label}-two', environment: 'Two', identity: 'bob', instanceId: 'token-two', baseURI: '${collector}',
        metricsBaseUrl: '${collector}/metrics', enableLiveUpdates: false, persistCache: false,
      })
      await pause(100)
      await getTogglyService().isFeatureOn('Other')
      recordUsage('NewManual')
      incrementCounter('orders', 3)
      await flushTelemetry()

      recordView('PageExit')
      window.dispatchEvent(new Event('pagehide'))
      await pause(100)
      const owner = getTogglyService()
      owner.dispose()
      window.dispatchEvent(new Event('pagehide'))
      await pause(100)
      const identityOwner = new Toggly({
        appKey: '${label}-identity', environment: 'Identity', baseURI: '${collector}',
        metricsBaseUrl: '${collector}/metrics', enableLiveUpdates: false, enableVariants: true,
        groups: ['beta'], claims: { plan: 'pro' },
      })
      const contexts = [{}, { identity: 'alice' }, { identity: 'bob' }, { instanceId: 'token-a' }, { instanceId: 'token-b' }, { instanceId: '', identity: 'bob' }, { identity: '' }]
      for (let index = 0; index < contexts.length; index++) {
        await identityOwner.setContext(contexts[index])
        identityOwner.recordUsage('step-' + index)
        identityOwner.setGauge('active', index)
      }
      await identityOwner.flushTelemetry()
      await identityOwner.setContext({ instanceId: 'token-a' })
      if (identityOwner.getVariant('V')?.name !== 'token-a') throw new Error('token A 304 did not hydrate its variant')
      let transition: Promise<void> | undefined
      identityOwner.setLocalGates([{ id: 'switch', flagKeys: ['V'], isEnabled: () => {
        transition = identityOwner.setContext({ instanceId: 'token-b' })
        return true
      } }])
      if (identityOwner.getVariantValue('V') !== 'token-a') throw new Error('reentrant variant value changed')
      await transition
      identityOwner.recordView('new-token')
      await identityOwner.flushTelemetry()
      identityOwner.recordView('identity-exit')
      window.dispatchEvent(new Event('pagehide'))
      await pause(100)
      identityOwner.dispose()
      window.dispatchEvent(new Event('pagehide'))
      await pause(100)
      state = 'done'
      document.documentElement.dataset.acceptance = 'done'
    } catch (error) {
      state = 'error:' + String(error)
      document.documentElement.dataset.acceptance = state
    }
  })
</script>

<Feature featureKey="Cold">cold-enabled</Feature>
<pre id="acceptance">{state}</pre>
`
}

function findEnvelope(requests, key, predicate) {
  return requests.find(request => request.envelope.k === key && predicate(request.envelope))
}

function verify(label, requests, optionsCount, definitions) {
  assert(optionsCount > 0, `${label}: telemetry CORS preflight was not observed`)
  assert(requests.length === 15, `${label}: expected fifteen telemetry requests, received ${requests.length}: ${JSON.stringify(requests)}`)
  assert(requests.every(request => request.origin?.startsWith('http://127.0.0.1:')), `${label}: missing browser Origin`)

  const first = findEnvelope(requests, `${label}-one`, envelope => envelope.f?.Manual)
  assert(first?.envelope.u === 'alice' && !first.envelope.i, `${label}: initial identity missing`)
  assert(first?.encoding === 'gzip', `${label}: ordinary flush was not gzip encoded`)
  assert(first.envelope.f.Cold?.enabled?.[0] === 1, `${label}: cold component evaluation was not counted exactly once`)
  assert(first.envelope.f.Manual?.blue?.[1] === 1, `${label}: usage payload mismatch`)
  assert(first.envelope.f.Manual?.green?.[2] === 1, `${label}: view payload mismatch`)
  assert(first.envelope.m?.orders === 2 && first.envelope.m?.active === 5, `${label}: explicit metric payload mismatch`)

  const replacement = findEnvelope(requests, `${label}-one`, envelope => envelope.f?.OldPending)
  assert(replacement?.envelope.u === 'alice', `${label}: old identity lost on replacement`)
  assert(replacement && replacement.encoding === 'identity', `${label}: replacement did not final-flush the old owner`)
  assert(!requests.some(request => request.envelope.k === `${label}-two` && request.envelope.f?.OldPending), `${label}: old data was relabeled to the new owner`)

  const second = findEnvelope(requests, `${label}-two`, envelope => envelope.f?.NewManual)
  assert(second?.envelope.i === 'token-two' && !second.envelope.u, `${label}: minted identity precedence missing`)
  assert(second?.encoding === 'gzip', `${label}: second ordinary flush was not gzip encoded`)
  assert(second.envelope.f.Cold?.enabled?.[0] === 1, `${label}: replacement component evaluation was not counted once: ${JSON.stringify(requests)}`)
  assert(second.envelope.f.Other?.disabled?.[0] === 1, `${label}: effective disabled result missing`)
  assert(second.envelope.f.NewManual?.enabled?.[1] === 1 && second.envelope.m?.orders === 3, `${label}: new-owner explicit payload mismatch`)

  const pagehide = findEnvelope(requests, `${label}-two`, envelope => envelope.f?.PageExit)
  assert(pagehide && pagehide.encoding === 'identity', `${label}: pagehide did not use the exit transport`)
  assert(pagehide.envelope.i === 'token-two', `${label}: exit identity missing`)
  const expected = [{}, { u: 'alice' }, { u: 'bob' }, { i: 'token-a' }, { i: 'token-b' }, { u: 'bob' }, {}]
  expected.forEach((identity, index) => {
    const request = findEnvelope(requests, `${label}-identity`, envelope => envelope.f?.['step-' + index])
    assert(request?.envelope.i === identity.i && request?.envelope.u === identity.u, `${label}: step ${index} attribution mismatch`)
    assert(request.envelope.m?.active === index && request.envelope.f['step-' + index].enabled[1] === 1, `${label}: step ${index} aggregates changed`)
  })
  // The context transition seals the first check; a reentrant captured check
  // forms a second immutable partition for the same previous token.
  const captured = requests.filter(({ envelope }) => envelope.k === `${label}-identity` && envelope.f?.V)
  assert(captured.length === 2 && captured.every(({ envelope }) => envelope.i === 'token-a' && envelope.f.V['token-a'][0] === 1), `${label}: evaluated variant attribution changed`)
  const newToken = findEnvelope(requests, `${label}-identity`, envelope => envelope.f?.['new-token'])
  assert(newToken?.envelope.i === 'token-b', `${label}: immediate post-transition event lost`)
  const exit = findEnvelope(requests, `${label}-identity`, envelope => envelope.f?.['identity-exit'])
  assert(exit?.envelope.i === 'token-b' && exit.encoding === 'identity', `${label}: token exit transport mismatch`)
  assert(requests.every(({ envelope }) => Object.keys(envelope).every(key => ['k', 'e', 'i', 'u', 'f', 'm'].includes(key))), `${label}: unexpected telemetry fields`)
  const tokenRequests = definitions.filter(({ url }) => url.searchParams.has('i'))
  assert(tokenRequests.length >= 5, `${label}: token definitions not observed`)
  assert(tokenRequests.every(({ url }) => ![...url.searchParams.keys()].some(key => key === 'u' || key === 'userId' || key === 'g' || key.startsWith('claim.'))), `${label}: client targeting leaked alongside token`)
  assert(tokenRequests.some(({ url, revision }) => url.searchParams.get('i') === 'token-a' && revision === 'token-a'), `${label}: token return did not use its scoped revision`)
}

try {
  await run('npm', ['run', 'build'], root)
  await run('npm', ['pack', '--pack-destination', temporary], root)
  const archive = (await readdir(temporary)).find(entry => entry.endsWith('.tgz'))
  if (!archive) throw new Error('npm pack did not produce a Svelte SDK archive')

  for (const label of hosts) {
    const host = join(temporary, label)
    await cp(join(root, 'tests', 'host', label), host, { recursive: true })
    // Registry resolution is the default; opt into an actual local artifact only for intermediate integration.
    const packages = [join(temporary, archive)]
    if (telemetryArchive) packages.push(telemetryArchive)
    await run('npm', ['install', '--no-save', '--package-lock=false', ...packages], host)

    const requests = []
    const definitions = []
    let optionsCount = 0
    const collector = createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? 'content-type,content-encoding')
      if (request.method === 'OPTIONS') {
        if (request.url?.includes('/api/frontend/telemetry')) optionsCount++
        response.writeHead(204).end()
        return
      }
      if (request.method === 'POST' && request.url === '/metrics/api/frontend/telemetry') {
        const chunks = []
        request.on('data', chunk => chunks.push(chunk))
        request.on('end', () => {
          const encoding = request.headers['content-encoding'] === 'gzip' ? 'gzip' : 'identity'
          const bytes = Buffer.concat(chunks)
          const body = encoding === 'gzip' ? gunzipSync(bytes) : bytes
          requests.push({ envelope: JSON.parse(body.toString('utf8')), encoding, origin: request.headers.origin })
          response.writeHead(202).end()
        })
        return
      }
      const url = new URL(request.url, 'http://127.0.0.1')
      const token = url.searchParams.get('i')
      const revision = request.headers['if-none-match']
      definitions.push({ url, revision })
      response.setHeader('Content-Type', 'application/json')
      if (url.pathname.includes('evaluated-variants-signed')) {
        const value = token ?? url.searchParams.get('userId') ?? 'anonymous'
        response.setHeader('ETag', value)
        if (revision === value) response.writeHead(304).end()
        else response.end(JSON.stringify({ V: { enabled: true, variant: value, configurationValue: value } }))
      } else response.end(JSON.stringify({ Cold: true, Other: false }))
    })
    const collectorPort = await listen(collector)
    const collectorUrl = `http://127.0.0.1:${collectorPort}`
    await writeFile(join(host, 'src', 'App.svelte'), appSource(collectorUrl, label))
    await run('npm', ['run', 'build'], host)

    const dist = join(host, 'dist')
    const staticServer = createServer(async (request, response) => {
      const path = request.url === '/' ? 'index.html' : request.url.slice(1).split('?')[0]
      try {
        const body = await readFile(join(dist, path))
        response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream')
        response.end(body)
      } catch {
        response.writeHead(404).end()
      }
    })
    const staticPort = await listen(staticServer)
    try {
      console.log(`${label}: browser phase (Node ${process.version}/${process.arch}, ${translated ? 'native ARM Chrome' : 'default Chrome'})`)
      const result = await run(browser, [
        ...browserPrefix,
        '--headless=new', '--disable-background-networking', '--disable-default-apps',
        '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--no-first-run',
        `--user-data-dir=${join(temporary, `${label}-chrome`)}`,
        '--virtual-time-budget=5000', '--dump-dom', `http://127.0.0.1:${staticPort}/`,
      ], host, true, 'data-acceptance="done"')
      assert(result.stdout.includes('data-acceptance="done"'), `${label}: browser app did not complete\n${result.stdout}\n${result.stderr}`)
      verify(label, requests, optionsCount, definitions)
      console.log(`${label}: browser telemetry acceptance passed (${requests.length} collector packets, ${optionsCount} preflights)`)
    } finally {
      await close(staticServer)
      await close(collector)
      await rm(host, { recursive: true, force: true })
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
