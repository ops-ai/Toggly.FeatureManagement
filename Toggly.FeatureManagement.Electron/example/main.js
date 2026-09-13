import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initToggly,
  registerTogglyIpc,
  closeToggly,
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

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  closeToggly()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
