import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const sdkDirectory = dirname(packageDirectory)
const electronExecutable = process.platform === 'darwin'
  ? join(sdkDirectory, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : join(sdkDirectory, 'node_modules', '.bin', 'electron')
const electronApplication = join(sdkDirectory, 'node_modules', 'electron', 'dist', 'Electron.app')
const fixtureTimeoutMs = 15_000

const fixtureDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

type ElectronRunResult = {
  exitCode: number | null
  stderr: string
  launchStrategy: 'direct' | 'launch-services'
}

function waitForElectronExit(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  launchStrategy: ElectronRunResult['launchStrategy'],
): Promise<ElectronRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    let stderr = ''
    let settled = false
    const settle = (result: ElectronRunResult | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      settle(new Error(
        `Electron preload fixture timed out after ${fixtureTimeoutMs}ms using ${launchStrategy}.`,
      ))
    }, fixtureTimeoutMs)

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', (error) => settle(error))
    child.once('close', (exitCode) => settle({ exitCode, stderr, launchStrategy }))
  })
}

function runElectron(
  fixtureDirectory: string,
  preloadPath: string,
  reportPath: string,
): Promise<ElectronRunResult> {
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TOGGLY_PRELOAD_PATH: preloadPath,
    TOGGLY_REPORT_PATH: reportPath,
  }

  if (process.platform === 'darwin') {
    // LaunchServices initializes the Electron application in the same way as
    // a user opening Electron.app. Directly spawning its Mach-O executable
    // can abort inside AppKit before the ESM main module gets control.
    return waitForElectronExit(
      '/usr/bin/open',
      [
        '--wait-apps',
        '--new',
        '--hide',
        electronApplication,
        '--args',
        fixtureDirectory,
        '--headless',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
      env,
      'launch-services',
    )
  }

  return waitForElectronExit(
    electronExecutable,
    [fixtureDirectory, '--headless', '--disable-gpu', '--disable-software-rasterizer'],
    env,
    'direct',
  )
}

function withoutKnownMacDisplayDiagnostic(stderr: string): string {
  // Electron 44 can emit this macOS display-link diagnostic in headless mode
  // before BrowserWindow starts. It is unrelated to preload execution, which
  // the fixture verifies through its exit code and renderer bridge report.
  return stderr.replace(
    /^\[\d+:\d{4}\/\d{6}\.\d+:ERROR:ui\/display\/mac\/cv_display_link_mac\.mm:195\] CVDisplayLinkCreateWithCGDisplay failed\. CVReturn: -6670\r?\n?/gm,
    '',
  )
}

describe('Electron preload runtime', () => {
  it('loads the compiled CommonJS preload entry from an ESM Electron app', async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), 'toggly-electron-preload-'))
    fixtureDirectories.push(fixtureDirectory)
    const reportPath = join(fixtureDirectory, 'report.json')
    const preloadPath = join(sdkDirectory, 'dist', 'preload', 'entry.cjs')

    await writeFile(join(fixtureDirectory, 'package.json'), '{"type":"module","main":"main.mjs"}\n')
    await writeFile(
      join(fixtureDirectory, 'main.mjs'),
      `import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

const reportPath = process.env.TOGGLY_REPORT_PATH
if (!reportPath) {
  throw new Error('TOGGLY_REPORT_PATH is required by the preload fixture')
}

let finished = false
const complete = async (exitCode, report) => {
  if (finished) return
  finished = true
  clearTimeout(timeout)
  await writeFile(reportPath, JSON.stringify(report))
  app.exit(exitCode)
}
const fail = (error) => {
  void complete(3, { completed: false, error: String(error) })
}
const timeout = setTimeout(() => {
  fail(new Error('The Electron preload fixture did not complete within 10 seconds'))
}, 10_000)

process.once('uncaughtException', fail)
process.once('unhandledRejection', fail)

app.whenReady().then(async () => {
  const messages = []
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: process.env.TOGGLY_PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  window.webContents.on('preload-error', (_event, path, error) => {
    messages.push({ path, error: String(error) })
  })
  await window.loadURL('data:text/html,<main>preload fixture</main>')
  const bridge = await window.webContents.executeJavaScript(
    "typeof window.toggly + ':' + typeof window.toggly?.getFlags",
  )
  await complete(
    bridge === 'object:function' && messages.length === 0 ? 0 : 2,
    { completed: true, bridge, messages },
  )
}).catch(fail)
`,
    )

    const result = await runElectron(fixtureDirectory, preloadPath, reportPath)
    if (process.platform === 'darwin') {
      expect(result.launchStrategy).toBe('launch-services')
    }
    expect(result.exitCode).toBe(0)
    expect(withoutKnownMacDisplayDiagnostic(result.stderr)).toBe('')

    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      completed: boolean
      bridge: string
      messages: Array<{ path: string; error: string }>
    }

    expect(report).toEqual({ completed: true, bridge: 'object:function', messages: [] })
  }, 20_000)
})
