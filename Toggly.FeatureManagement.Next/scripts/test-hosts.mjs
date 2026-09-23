import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withResources, closeServer, stopChild } from './host-resources.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = await mkdtemp(join(tmpdir(), 'toggly-next-hosts-'))
const environment = {...process.env, NEXT_TELEMETRY_DISABLED: '1'}
const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {cwd, env: environment, stdio: 'inherit'})
  child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(Error(`${cmd} exited ${code}`)))
})
const artifact = process.env.TOGGLY_CLIENT_TELEMETRY_TARBALL
if (artifact) console.log('LOCAL INTEGRATION ARTIFACT: telemetry; registry acceptance remains pending')
const hosts = [
  {next: '14.2.35', react: '18.3.1', reactTypes: '18.3.18', domTypes: '18.3.5', nodeTypes: '22.20.2', lib: 'es2022', typescript: '5.9.3'},
  {next: '15.5.25', react: '19.3.0', reactTypes: '19.3.0', domTypes: '19.3.0', nodeTypes: '22.20.2', lib: 'es2022', typescript: '5.9.3'},
  {next: '16.3.5', react: '19.3.0', reactTypes: '19.3.0', domTypes: '19.3.0', nodeTypes: '24.13.6', lib: 'esnext', typescript: '6.0.3'},
]
async function files(directory) {
  const result = []
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path)
  }
  return result
}
await withResources(async defer => {
  defer(() => rm(temporary, {recursive: true, force: true}))
  await run('pnpm', ['build'], root)
  for (const name of ['core', 'client']) await run('pnpm', ['pack', '--pack-destination', temporary], join(root, `nextjs-toggly-${name}`))
  const archives = (await readdir(temporary)).filter(name => name.endsWith('.tgz')).map(name => join(temporary, name))
  assert.equal(archives.length, 2)
  for (const fixture of hosts) {
    const host = join(temporary, `next-${fixture.next}`)
    await cp(join(root, 'tests/browser-host'), host, {recursive: true})
    const hostTypes = JSON.parse(await readFile(join(host, 'tsconfig.json'), 'utf8'))
    hostTypes.compilerOptions.lib = ['dom', 'dom.iterable', fixture.lib]
    await writeFile(join(host, 'tsconfig.json'), JSON.stringify(hostTypes, null, 2))
    await writeFile(join(host, 'package.json'), JSON.stringify({name: 'toggly-next-packed-host', private: true, type: 'module', dependencies: {next: fixture.next, react: fixture.react, 'react-dom': fixture.react}, devDependencies: {typescript: fixture.typescript, '@types/node': fixture.nodeTypes, '@types/react': fixture.reactTypes, '@types/react-dom': fixture.domTypes, 'puppeteer-core': '25.10.0'}}))
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...archives, ...(artifact ? [artifact] : [])], host)
    const versions = {}
    for (const [name, version] of [['next', fixture.next], ['react', fixture.react], ['typescript', fixture.typescript], ['@ops-ai/nextjs-toggly-core', '1.13.0'], ['@ops-ai/nextjs-toggly-client', '1.6.0'], ['@ops-ai/toggly-client-telemetry', '1.1.0']]) {
      versions[name] = JSON.parse(await readFile(join(host, 'node_modules', name, 'package.json'), 'utf8')).version
      assert.equal(versions[name], version)
    }
    console.log('ACTUAL REGISTRY HOST', JSON.stringify(versions))
    await run(process.execPath, [join(root, 'scripts/browser-cleanup-check.mjs')], host)
    await run(process.execPath, ['node_modules/next/dist/bin/next', 'build', ...(fixture.next.startsWith('16.') ? ['--webpack'] : [])], host)
    const typeConfig = JSON.parse(await readFile(join(host, 'tsconfig.json'), 'utf8'))
    assert.equal(typeConfig.compilerOptions.strict, true)
    assert.equal(typeConfig.compilerOptions.skipLibCheck, false)
    await run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], host)
    const chunks = (await files(join(host, '.next/static'))).filter(path => path.endsWith('.js'))
    assert.ok(chunks.length > 0)
    for (const path of chunks) {
      const code = await readFile(path, 'utf8')
      assert.doesNotMatch(code, /\/api\/usage\/stats|\/api\/metrics|@grpc\/grpc-js|@grpc\/proto-loader|protobufjs|UsageBatcher|MetricsBatcher/, `Trusted telemetry in browser chunk: ${path}`)
    }
    await run(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; import {createTogglyClient} from '@ops-ai/nextjs-toggly-core/browser'; const require=createRequire(import.meta.url); assert.equal(typeof require('@ops-ai/nextjs-toggly-core').TelemetryRuntime,'function'); let calls=0; globalThis.fetch=async()=>{calls++; throw Error('unexpected SSR fetch')}; const c=createTogglyClient({appKey:'server'}); c.telemetry.recordUsage('On'); c.telemetry.setGauge('cart',3); await c.flushTelemetry(); c.destroy(); assert.equal(calls,0);`], host)
    await withResources(async own => {
    const socket = createServer()
    own(() => closeServer(socket))
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
    const port = socket.address().port
    await new Promise(resolve => socket.close(resolve))
    const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {cwd: host, env: environment, stdio: 'inherit'})
    own(() => stopChild(server))
      let ready = false
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        try { const response = await fetch(`http://127.0.0.1:${port}`, {signal: AbortSignal.timeout(2000)}); if (response.ok) {ready = true; break} } catch {}
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.ok(ready, 'Next production server started')
      await run(process.execPath, [join(root, 'scripts/browser-check.mjs'), String(port)], host)
    })
    await rm(host, {recursive: true, force: true})
    console.log(`Next ${fixture.next}/React ${fixture.react}: TS ${fixture.typescript}/${fixture.lib}/Node types ${fixture.nodeTypes}, packed browser transport boundary, SSR, and host passed`)
  }
})
