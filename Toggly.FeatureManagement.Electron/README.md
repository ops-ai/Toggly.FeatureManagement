# @ops-ai/electron-feature-flags-toggly

Feature flags for Electron apps with a Flutter-like DX. The **main process** owns your App Key, fetches `/evaluated-signed` definitions, verifies signatures, caches under `userData`, and keeps a live WebSocket. The renderer uses `window.toggly` (exposed from preload) — no App Key in Chromium.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Install

```bash
npm install @ops-ai/electron-feature-flags-toggly
```

Peer: Electron ≥ 28. React ≥ 18 is optional (only for `@ops-ai/electron-feature-flags-toggly/react`).

## Electron compatibility

The declared Electron floor is 28. Actual packed native hosts are validated on
Electron 28.3.3 and Electron 44.3.0. Each host runs the SDK from a packed
artifact in a real Electron main process, the compiled CommonJS preload with
context isolation, the renderer IPC bridge, and the optional React helpers.
The Electron peer range preserves compatible retained majors; this evidence
does not make an untested Electron major a tested support claim.

For local host validation, run `npm run test:hosts`. It installs disposable
host applications with public npm dependencies and launches hidden Electron
BrowserWindows. On Linux, provide a display server such as Xvfb for normal
Chromium multiprocess execution.

## Setup (3 snippets)

### 1. Main process

```js
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import {
  initToggly,
  registerTogglyIpc,
  isFeatureOn,
} from '@ops-ai/electron-feature-flags-toggly/main'

const require = createRequire(import.meta.url)
const togglyPreload = require.resolve('@ops-ai/electron-feature-flags-toggly/preload/entry')

await app.whenReady()

await initToggly({
  appKey: process.env.TOGGLY_APP_KEY,
  environment: 'Production',
  userDataPath: app.getPath('userData'),
  flagDefaults: {
    NewDashboard: false,
    BetaMenu: false,
  },
})

registerTogglyIpc(ipcMain, () => BrowserWindow.getAllWindows())

// Trusted process can gate menus / windows directly:
if (isFeatureOn('BetaMenu')) {
  // …
}
```

### 2. Preload bridge

```js
const window = new BrowserWindow({
  webPreferences: {
    preload: togglyPreload,
    contextIsolation: true,
    nodeIntegration: false,
  },
})
```

Electron executes `webPreferences.preload` files with its CommonJS loader, even
when your main process uses ESM. `preload/entry` is the package's compiled
CommonJS entry: it calls `exposeToggly()` and exposes only `window.toggly` to
the renderer. Resolve it from the main process as shown; do not point
`webPreferences.preload` at a source-level ESM `import` file.

If you need to add your own preload APIs, bundle your preload as CommonJS and
include `@ops-ai/electron-feature-flags-toggly/preload` in that bundle rather
than externalizing it. Electron's sandboxed preload loader cannot resolve an
arbitrary package with `require()` at runtime.

### 3. Renderer

```js
import { isFeatureOn, evaluateFeatureGate } from '@ops-ai/electron-feature-flags-toggly'

if (isFeatureOn('NewDashboard')) {
  showDashboard()
}

const unlock = evaluateFeatureGate(
  ['FeatureA', 'FeatureB'],
  'any',
  false,
)
```

## React (optional)

```tsx
import { Feature, useFeatureFlag } from '@ops-ai/electron-feature-flags-toggly/react'

export function App() {
  const { isEnabled } = useFeatureFlag('NewDashboard')

  return (
    <>
      <Feature featureKey="NewDashboard">
        <NewDashboard />
      </Feature>
      <Feature featureKey="NewDashboard" negate>
        <LegacyDashboard />
      </Feature>
      {isEnabled && <Badge />}
    </>
  )
}
```

## API overview

| Surface | Entry |
|---------|--------|
| Main | `@ops-ai/electron-feature-flags-toggly/main` |
| Preload bridge | `@ops-ai/electron-feature-flags-toggly/preload/entry` |
| Custom bundled preload | `@ops-ai/electron-feature-flags-toggly/preload` |
| Renderer | `@ops-ai/electron-feature-flags-toggly` or `/renderer` |
| React | `@ops-ai/electron-feature-flags-toggly/react` |

### Main

- `initToggly(config)` → `Promise<flags>`
- `getToggly()` / `closeToggly()`
- `isFeatureOn` / `isFeatureOff` / `evaluateFeatureGate`
- `setContext` / `clearContext` / `addHook`
- `registerTogglyIpc(ipcMain, getWindows)`

### Renderer (`window.toggly`)

- `isFeatureOn(key, entityContext?, kind?)`
- `evaluateFeatureGate(keys, requirement?, negate?, entityContext?, kind?)`
- `getFlags()` / `setContext` / `clearContext`
- `onFlagsUpdated(callback)` → unsubscribe

## Configuration

| Option | Default | Notes |
|--------|---------|--------|
| `appKey` | — | Frontend App Key |
| `environment` | `Production` | |
| `baseURI` | `https://definitions.toggly.io` | |
| `userDataPath` | **required** | `app.getPath('userData')` |
| `flagDefaults` | `{}` | Offline / no-key fallback |
| `identity` / `groups` / `claims` | | Targeting context |
| `verifySignatures` | `false` | ES256 via JWKS |
| `enableLiveUpdates` | `true` when `appKey` set | WebSocket in main |
| `connectTimeout` | `5000` | ms |
| `featureFlagsRefreshInterval` | `180000` | ms |

## Entity context

Entity-gated flags fail closed without a context. Pass an entity on each read:

```js
isFeatureOn('OrderBadge', order, 'Order')
```

## Signed definitions

Set `verifySignatures: true` to verify evaluated-signed envelopes in the main process before caching or serving results to the renderer.

## Example

See [`example/`](./example) for a minimal main + preload + HTML app.

## License

MIT © opsAI LLC
