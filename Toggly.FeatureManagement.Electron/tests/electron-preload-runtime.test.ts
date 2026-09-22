import { launchOwnedElectron } from './owned-process.mjs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const sdkDirectory = dirname(packageDirectory)
const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const electronApplication = dirname(dirname(dirname(electronExecutable)))
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
  report: string | undefined
  timedOut: boolean
  launchStrategy: 'direct'
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

function describeElectronRun(result: ElectronRunResult): string {
  return [
    `Electron preload fixture exited with ${result.exitCode} using ${result.launchStrategy}.`,
    `timed out: ${result.timedOut}`,
    `stderr:\n${result.stderr || '(empty)'}`,
    `report:\n${result.report || '(missing)'}`,
  ].join('\n')
}

function electronFixtureArguments(platform: NodeJS.Platform): string[] {
  const argumentsForFixture = [
    '--disable-gpu',
    '--disable-software-rasterizer',
  ]

  if (platform === 'linux') {
    // GitHub's Linux runner does not grant the downloaded Electron helper the
    // ownership required by Chromium's sandbox. The CI workflow supplies Xvfb,
    // so the fixture can keep Chromium's normal multiprocess browser behavior.
    // This only starts the isolated test fixture; it does not change SDK defaults.
    argumentsForFixture.push('--no-sandbox')
  } else {
    argumentsForFixture.push('--headless')
  }

  return argumentsForFixture
}

async function waitForElectronExit(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  launchStrategy: ElectronRunResult['launchStrategy'],
  stderrPath: string,
  reportPath: string,
  electronPidPath: string,
): Promise<ElectronRunResult> {
  const fixtureDirectory = dirname(electronPidPath)
  const result = await launchOwnedElectron(command, args, fixtureDirectory,
    process.platform === 'darwin' ? electronApplication : electronExecutable,
    env, fixtureTimeoutMs)
  return {
    exitCode: result.status,
    stderr: result.stderr + ((await readOptionalFile(stderrPath)) ?? ''),
    report: await readOptionalFile(reportPath),
    timedOut: false,
    launchStrategy,
  }
}

function runElectron(
  fixtureDirectory: string,
  preloadPath: string,
  reportPath: string,
): Promise<ElectronRunResult> {
  const stderrPath = join(fixtureDirectory, 'electron.stderr.log')
  const electronPidPath = join(fixtureDirectory, 'electron.pid')
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    TOGGLY_PRELOAD_PATH: preloadPath,
    TOGGLY_REPORT_PATH: reportPath,
    TOGGLY_PID_PATH: electronPidPath,
  }


  return waitForElectronExit(
    electronExecutable,
    [fixtureDirectory, `--user-data-dir=${join(fixtureDirectory, 'profile')}`, ...electronFixtureArguments(process.platform)],
    env,
    'direct',
    stderrPath,
    reportPath,
    electronPidPath,
  )
}

function withoutKnownElectronInfrastructureDiagnostics(stderr: string): string {
  // Electron 44 can emit this macOS display-link diagnostic in headless mode
  // before BrowserWindow starts. It is unrelated to preload execution, which
  // the fixture verifies through its exit code and renderer bridge report.
  const withoutMacDisplayDiagnostic = stderr.replace(
    /^\[\d+:\d{4}\/\d{6}\.\d+:ERROR:ui\/display\/mac\/cv_display_link_mac\.mm:195\] CVDisplayLinkCreateWithCGDisplay failed\. CVReturn: -6670\r?\n?/gm,
    '',
  )

  // GitHub's Linux runner has no session D-Bus service. Chromium reports these
  // two exact connection attempts even when the BrowserWindow and preload run
  // successfully under Xvfb. Keep every other stderr line visible to this test.
  return withoutMacDisplayDiagnostic
    .replace(
      /^\[\d+:\d{4}\/\d{6}\.\d+:ERROR:dbus\/bus\.cc:406\] Failed to connect to the bus: Could not parse server address: Unknown address type \(examples of valid types are "tcp" and on UNIX "unix"\)\r?\n?/gm,
      '',
    )
    .replace(
      /^\[\d+:\d{4}\/\d{6}\.\d+:ERROR:dbus\/object_proxy\.cc:572\] Failed to call method: org\.freedesktop\.DBus\.NameHasOwner: object_path= \/org\/freedesktop\/DBus: unknown error type: \r?\n?/gm,
      '',
    )
}

describe('Electron preload runtime', () => {
  it('removes only the known display and session-bus infrastructure diagnostics', () => {
    const diagnostics = [
      '[123:0912/233532.881172:ERROR:dbus/bus.cc:406] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix")',
      '[123:0912/233533.012923:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type: ',
      'unexpected preload diagnostic',
    ].join('\n')

    expect(withoutKnownElectronInfrastructureDiagnostics(diagnostics)).toBe('unexpected preload diagnostic')
  })

  it('uses only the Linux sandbox exception when CI provides a display', () => {
    expect(electronFixtureArguments('linux')).toEqual([
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-sandbox',
    ])
    expect(electronFixtureArguments('darwin')).toContain('--headless')
    expect(electronFixtureArguments('darwin')).not.toContain('--no-sandbox')
    expect(electronFixtureArguments('darwin')).not.toContain('--ozone-platform=headless')
    expect(electronFixtureArguments('darwin')).not.toContain('--single-process')
    expect(electronFixtureArguments('win32')).toContain('--headless')
    expect(electronFixtureArguments('win32')).not.toContain('--no-sandbox')
    expect(electronFixtureArguments('win32')).not.toContain('--ozone-platform=headless')
    expect(electronFixtureArguments('win32')).not.toContain('--single-process')
  })

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

app.setPath('userData', ${JSON.stringify(join(fixtureDirectory, 'profile'))})
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')

const reportPath = process.env.TOGGLY_REPORT_PATH
if (!reportPath) {
  throw new Error('TOGGLY_REPORT_PATH is required by the preload fixture')
}
const pidPath = process.env.TOGGLY_PID_PATH
if (!pidPath) {
  throw new Error('TOGGLY_PID_PATH is required by the preload fixture')
}
await writeFile(pidPath, String(process.pid))

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
      expect(result.launchStrategy).toBe('direct')
    }
    expect(result.timedOut, describeElectronRun(result)).toBe(false)
    expect(result.exitCode, describeElectronRun(result)).toBe(0)
    expect(withoutKnownElectronInfrastructureDiagnostics(result.stderr), describeElectronRun(result)).toBe('')
    expect(result.report, describeElectronRun(result)).toBeDefined()

    const report = JSON.parse(result.report!) as {
      completed: boolean
      bridge: string
      messages: Array<{ path: string; error: string }>
    }

    expect(report).toEqual({ completed: true, bridge: 'object:function', messages: [] })
  }, 20_000)
})
