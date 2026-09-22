// Test-only owner starts before creating compilation resources. Its stdin is
// the requesting parent's liveness pipe; emitted PIDs are evidence, not authority.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const token = process.argv[2]
const lifetime = Number(process.argv[3])
let directory, compiler, completion, closed = false, started = false, failure
let buffer = ''
const emit = value => { if (!closed) process.stdout.write(token + JSON.stringify(value) + '\n') }
process.stdout.on('error', error => { if (error.code === 'EPIPE') retire(); else { failure ??= error; retire() } })
process.stderr.on('error', () => retire())
let finishing
function retire() {
  closed = true
  if (finishing) return finishing
  finishing = (async () => {
    // The live retained child pins this group. Never signal a historical PID.
    if (compiler && compiler.exitCode === null && compiler.signalCode === null) {
      try { process.kill(-compiler.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') failure ??= error }
    }
    if (completion) await completion
    if (directory) { try { rmSync(directory, {recursive:true, force:true}) } catch (error) { failure ??= error } }
    clearTimeout(deadline)
    process.exitCode = failure ? 1 : 0
    process.stdin.destroy()
  })()
  return finishing
}
const deadline = setTimeout(() => { failure ??= new Error('Preparation owner lifetime exceeded'); retire() }, lifetime)
process.stdin.on('end', retire)
process.stdin.on('error', error => { failure ??= error; retire() })
process.on('SIGINT', retire); process.on('SIGTERM', retire)
process.stdin.on('data', chunk => {
  buffer += chunk
  if (buffer.length > 16 || buffer.includes('\n') && buffer !== 'PREPARE\n') { failure ??= new Error('Invalid preparation admission'); retire(); return }
  if (buffer !== 'PREPARE\n' || started || closed) return
  started = true
  directory = mkdtempSync(join(tmpdir(), 'toggly-electron-native-owner-'))
  const args = ['swiftc', fileURLToPath(new URL('./native-electron-owner.swift', import.meta.url)), '-o', join(directory, 'owner')]
  compiler = spawn('/usr/bin/xcrun', args, {cwd:directory, detached:true, stdio:['ignore','ignore','pipe']})
  let errors = ''
  compiler.stderr.on('data', chunk => { errors += chunk; if (errors.length > 8_000_000) { failure ??= new Error('Compiler output exceeded8MB'); retire() } })
  completion = new Promise(resolve => {
    compiler.once('error', error => { failure ??= error; resolve() })
    compiler.once('close', (code, signal) => { if (!closed && code !== 0) failure ??= new Error(`Compiler exited ${code ?? signal}: ${errors}`); resolve() })
  })
  compiler.once('spawn', () => emit({compiler:{pid:compiler.pid,args,directory}}))
  const compileDeadline = setTimeout(() => { failure ??= new Error('Compiler exceeded60000ms'); retire() }, 60000)
  void completion.then(() => {
    clearTimeout(compileDeadline)
    if (failure) { emit({preparationError:String(failure)}); return retire() }
    if (!closed) emit({prepared:directory})
  })
})
