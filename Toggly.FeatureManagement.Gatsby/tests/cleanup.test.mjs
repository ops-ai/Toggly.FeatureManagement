import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { cleanupOwned, closeBrowser, closeServer, runOwnedCommand, stopChild } from './owned-resources.mjs'

const file = fileURLToPath(import.meta.url)
if (process.argv[2] === '--scenario') {
  const [scenario, resultFile] = process.argv.slice(3)
  const preview = createServer(), collector = createServer()
  const directory = mkdtempSync(join(tmpdir(), 'gatsby-cleanup-control-'))
  let child, original, outcome
  try {
    await Promise.all([preview, collector].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
    if (scenario === 'launch') throw new Error('original launch failure')
    child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    throw new Error('original assertion failure')
  } catch (error) { original = error }
  try {
    await cleanupOwned([
      () => child && closeBrowser({ process: () => child, close: () => scenario === 'close-reject' ? Promise.reject(new Error('browser close failure')) : scenario === 'close-hang' ? new Promise(() => {}) : stopChild(child) }, 75),
      () => closeServer(preview),
      () => closeServer(collector),
      () => { if (scenario === 'cleanup') throw new Error('artifact removal failure') },
      () => rmSync(directory, { recursive: true, force: true }),
      () => { if (scenario === 'logging') throw new Error('logging failure') },
    ], original)
  } catch (error) { outcome = error }
  writeFileSync(resultFile, JSON.stringify({ previewListening: preview.listening, collectorListening: collector.listening,
    childReaped: !child || child.exitCode !== null || child.signalCode !== null, directoryExists: existsSync(directory),
    cause: outcome?.cause?.message, errors: outcome?.errors?.map(error => error.message) }))
  process.exitCode = outcome ? 1 : 0
} else {
  for (const scenario of ['launch', 'assertion', 'close-reject', 'close-hang', 'cleanup', 'logging']) {
    test(`owned cleanup preserves failure and reaps real resources: ${scenario}`, { timeout: 10000 }, async () => {
      const root = mkdtempSync(join(tmpdir(), 'gatsby-cleanup-test-'))
      try {
        const result = join(root, 'result.json')
        await assert.rejects(runOwnedCommand(process.execPath, [file, '--scenario', scenario, result], {}, 3000))
        const evidence = JSON.parse(readFileSync(result, 'utf8'))
        assert.deepEqual({ preview: evidence.previewListening, collector: evidence.collectorListening, child: evidence.childReaped, artifact: evidence.directoryExists }, { preview: false, collector: false, child: true, artifact: false })
        assert.equal(evidence.cause, scenario === 'launch' ? 'original launch failure' : 'original assertion failure')
        assert.equal(evidence.errors.length, ['close-reject', 'close-hang', 'cleanup', 'logging'].includes(scenario) ? 2 : 1)
      } finally { rmSync(root, { recursive: true, force: true }) }
    })
  }
  test('command output keeps stderr out of structured stdout', async () => {
    assert.equal(await runOwnedCommand(process.execPath, ['-e', `console.error('diagnostic');console.log('[]')`], {}), '[]\n')
  })
  test('command deadline kills an actual hung child and its descendant process group', { timeout: 10000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'router-command-test-'))
    const pidFile = join(root, 'pids.json')
    try {
      const script = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);c.on('spawn',()=>writeFileSync(process.argv[1],JSON.stringify([process.pid,c.pid])));setInterval(()=>{},1000)`
      await assert.rejects(runOwnedCommand(process.execPath, ['-e', script, pidFile], {}, 300), /Packed host failed/)
      const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
      for (const pid of pids) {
        const deadline = Date.now() + 2000
        let alive = true
        while (alive && Date.now() < deadline) {
          try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 20)) } catch { alive = false }
        }
        assert.equal(alive, false, `owned process ${pid} survived`)
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}
