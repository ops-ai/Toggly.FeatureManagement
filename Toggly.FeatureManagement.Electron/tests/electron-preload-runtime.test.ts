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

const fixtureDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function runElectron(
  fixtureDirectory: string,
  preloadPath: string,
  reportPath: string,
): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      electronExecutable,
      [fixtureDirectory, '--headless', '--disable-gpu', '--disable-software-rasterizer'],
      {
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          TOGGLY_PRELOAD_PATH: preloadPath,
          TOGGLY_REPORT_PATH: reportPath,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )

    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, stderr }))
  })
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
  await writeFile(process.env.TOGGLY_REPORT_PATH, JSON.stringify({ bridge, messages }))
  app.exit(bridge === 'object:function' && messages.length === 0 ? 0 : 2)
})
`,
    )

    const result = await runElectron(fixtureDirectory, preloadPath, reportPath)
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      bridge: string
      messages: Array<{ path: string; error: string }>
    }

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
    expect(report).toEqual({ bridge: 'object:function', messages: [] })
  }, 20_000)
})
