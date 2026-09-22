import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initToggly,
  registerTogglyIpc,
  attachTogglyLifecycle,
} from '../dist/main/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function createWindow() {
  await initToggly({
    appKey: process.env.TOGGLY_APP_KEY,
    environment: 'Production',
    userDataPath: app.getPath('userData'),
    flagDefaults: {
      ExampleFeature: true,
      HiddenFeature: false,
    },
    isDebug: true,
  })

  registerTogglyIpc(ipcMain, () => BrowserWindow.getAllWindows())
  attachTogglyLifecycle(app, powerMonitor)

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // Electron loads raw preload files with CommonJS semantics. Use the
      // package's compiled entry instead of a source-level ESM import.
      preload: path.join(__dirname, '../dist/preload/entry.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
