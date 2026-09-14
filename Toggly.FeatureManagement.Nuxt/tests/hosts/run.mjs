import { mkdtemp, cp, writeFile, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { verifyAutomaticStartup } from './automatic-startup.test.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const version = process.argv[2] || '4.5.2'
const lockMode = process.argv[3] || 'fresh'
assert(['fresh', 'record', 'locked'].includes(lockMode), 'use fresh, record, or locked mode')
const retainedNode18 = version === '3.16.2'
assert(!retainedNode18 || lockMode === 'locked', 'Nuxt 3.16.2 is the frozen Node 18 compatibility profile; use locked mode')
const lockDir = join(root, 'tests/hosts/locks', version)
const work = await mkdtemp(join(tmpdir(), `nuxt-toggly-${version}-`))
console.log(`Host evidence: ${work}; Nuxt ${version}; Node ${process.version}`)
const run = (command, args, cwd = work) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: process.env })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
})
await cp(join(root, 'tests/hosts/fixture'), work, { recursive: true })
if (version.startsWith('3.')) await cp(join(work, 'app/app.vue'), join(work, 'app.vue'))
if (version === '3.0.0') {
  const configPath = join(work, 'nuxt.config.ts')
  const config = await readFile(configPath, 'utf8')
  await writeFile(configPath, config.replace(/  compatibilityDate:.*\n/, '').replace(/  devtools:.*\n/, ''))
}
await mkdir(join(work, 'artifacts'))
const dependencies = retainedNode18
  ? { nuxt: version, '@nuxt/kit': '3.16.2', vue: '3.5.13', playwright: '1.51.1', typescript: '5.7.3', 'vue-tsc': '2.2.4' }
  : { nuxt: version, vue: '3.5.42', playwright: '1.58.2', typescript: '5.9.3', 'vue-tsc': '3.2.4' }
for (const name of ['core', 'client', 'server', '']) {
  const dir = name ? `nuxt-toggly-${name}` : 'nuxt-toggly'
  const pkg = JSON.parse(await readFile(join(root, dir, 'package.json')))
  await run('pnpm', ['pack', '--pack-destination', join(work, 'artifacts')], join(root, dir))
  dependencies[pkg.name] = `file:./artifacts/${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
}
assert(!process.env.TOGGLY_SIGNED_DEFS_ARTIFACT, 'shared dependencies must resolve from the public registry')
dependencies['@ops-ai/toggly-signed-defs'] = '1.2.7'
const manifest = { private: true, type: 'module', dependencies }
const packedSdkDependencies = Object.entries(dependencies).filter(([name]) => name.startsWith('@ops-ai/nuxt-toggly'))
const artifactPath = spec => spec.replace('file:./', '')
const artifactIntegrity = async spec => `sha512-${createHash('sha512').update(await readFile(join(work, artifactPath(spec)))).digest('base64')}`
if (lockMode === 'locked') {
  const lockedManifest = JSON.parse(await readFile(join(lockDir, 'package.json'), 'utf8'))
  assert.deepEqual(lockedManifest, manifest, 'consumer lock must match the packed candidate versions and dependency mode')
  const consumerLock = JSON.parse(await readFile(join(lockDir, 'package-lock.json'), 'utf8'))
  // The four SDK packages are freshly packed for each host run. Preserve the
  // committed public-registry graph, then bind its local candidate entries to
  // these exact artifact bytes so npm ci still verifies their integrity.
  for (const [name, spec] of packedSdkDependencies) {
    const artifact = artifactPath(spec)
    const entry = consumerLock.packages[`node_modules/${name}`]
    assert.equal(entry?.resolved, `file:${artifact}`, `${name} must remain a packed local candidate`)
    entry.integrity = await artifactIntegrity(spec)
  }
  await writeFile(join(work, 'package-lock.json'), JSON.stringify(consumerLock, null, 2) + '\n')
}
await writeFile(join(work, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(join(work, 'tsconfig.json'), JSON.stringify({ extends: './.nuxt/tsconfig.json' }))
if (lockMode === 'record') {
  await run('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'])
  await mkdir(lockDir, { recursive: true })
  await cp(join(work, 'package.json'), join(lockDir, 'package.json'))
  await cp(join(work, 'package-lock.json'), join(lockDir, 'package-lock.json'))
}
await run('npm', [lockMode === 'fresh' ? 'install' : 'ci', '--no-audit', '--no-fund', ...(retainedNode18 ? ['--engine-strict'] : [])])
// Install the browser through this consumer's own Playwright dependency. This
// keeps Nuxt 3's locked host and Nuxt 4's fresh host aligned with the exact
// Playwright revision that each packed consumer resolved.
await run('npx', ['playwright', 'install', 'chromium'])
const consumerLock = JSON.parse(await readFile(join(work, 'package-lock.json'), 'utf8'))
for (const [name, spec] of packedSdkDependencies) {
  assert.equal(consumerLock.packages[`node_modules/${name}`]?.integrity, await artifactIntegrity(spec), `${name} integrity must match its packed candidate`)
}
for (const [path, pkg] of Object.entries(consumerLock.packages)) {
  if (!path || Object.keys(dependencies).some(name => name.startsWith('@ops-ai/nuxt-toggly') && path === `node_modules/${name}`)) continue
  if (pkg.resolved) assert(pkg.resolved.startsWith('https://registry.npmjs.org/'), `${path} must resolve from public npm`)
}
assert.equal(consumerLock.packages['node_modules/@ops-ai/toggly-signed-defs'].version, '1.2.7')
console.log(`Consumer resolution: ${lockMode === 'fresh' ? 'fresh install' : 'npm ci from recorded lock'}; ${version}`)
await run('npx', ['nuxt', 'prepare'])
await run('npx', ['nuxt', 'typecheck'])
await run('npx', ['nuxt', 'build'])
const { chromium } = await import(pathToFileURL(join(work, 'node_modules/playwright/index.mjs')).href)
const { createServer } = await import('node:net')
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r))
const host = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: work, stdio: 'inherit', env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' } })
const url = `http://127.0.0.1:${port}`
let browser
try {
  let response
  for (let i = 0; i < 100; i++) { try { response = await fetch(url); if (response.ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  assert(response?.ok, 'production host starts')
  const html = await response.text()
  assert.match(html, /id="gate"/); assert.match(html, /id="negated"/); assert.doesNotMatch(html, /id="all"/)
  const [alice, bob] = await Promise.all(['alice', 'bob'].map(async identity => {
    const headers = { 'x-toggly-identity': identity }
    const data = await (await fetch(url + '/api/context', { headers })).json()
    const html = await (await fetch(url, { headers })).text()
    return { data, html }
  }))
  assert.equal(alice.data.enabled, true); assert.equal(bob.data.enabled, false)
  assert.equal(alice.data.identity, 'server-default'); assert.equal(bob.data.identity, 'server-default')
  assert.equal(alice.data.off, true); assert.equal(alice.data.any, true)
  assert.match(alice.html, /id="target">true/); assert.match(bob.html, /id="target">false/)
  assert.match(alice.html, /id="ssr-core">true/); assert.match(bob.html, /id="ssr-core">false/)
  assert.doesNotMatch(alice.html, /Audience.Users/)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ extraHTTPHeaders: { 'x-toggly-identity': 'alice' } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', msg => { if (/hydration|mismatch/i.test(msg.text())) errors.push(msg.text()) })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('#mounted')?.textContent === 'true')
  assert.equal(await page.locator('#target').textContent(), 'true')
  assert.equal(await page.locator('#core-target').textContent(), 'true', 'public core agrees with hydrated Vue flags')
  assert.equal(await page.locator('#core-gate').textContent(), 'true', 'public core gates use hydrated flags')
  assert.equal(await page.locator('#gate').count(), 1)
  await page.locator('#init').click()
  await page.waitForFunction(() => document.querySelector('#initialized')?.textContent === 'true')
  await page.locator('#identity').click()
  await page.waitForFunction(() => document.querySelector('#flag')?.textContent === 'false')
  await page.waitForFunction(() => document.querySelector('#core-target')?.textContent === 'false')
  assert.equal(await page.locator('#core-gate').textContent(), 'false')
  assert.equal(await page.locator('#gate').count(), 0)
  assert.equal(await page.locator('#directive').isVisible(), false)
  const refreshed = page.waitForResponse(response => response.url().includes('/api/definitions/'))
  await page.locator('#refresh').click()
  await refreshed
  await page.waitForFunction(() => document.querySelector('#target')?.textContent === 'false')
  assert.deepEqual(errors, [])
  console.log(`PASS Nuxt ${version}: packed install, types, build, SSR gates, request isolation, hydration, initialization, identity, refresh, directives`)
} finally {
  await browser?.close()
  const stopped = host.exitCode !== null || host.signalCode !== null
    ? Promise.resolve() : new Promise(resolve => host.once('exit', resolve))
  host.kill('SIGTERM')
  await stopped
}
await verifyAutomaticStartup(work, chromium)
