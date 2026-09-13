import { exposeToggly } from './index.js'

/**
 * Electron executes BrowserWindow preload files with its CommonJS loader,
 * including when the app's main process uses ESM. Configure this compiled
 * entry as `webPreferences.preload` so the bridge runs in that loader.
 */
exposeToggly()
