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

## Setup (3 snippets)

### 1. Main process

```js
import { app, BrowserWindow } from 'electron'
import {
  initToggly,
  registerTogglyIpc,
  isFeatureOn,
} from '@ops-ai/electron-feature-flags-toggly/main'

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

registerTogglyIpc(require('electron').ipcMain, () => BrowserWindow.getAllWindows())

// Trusted process can gate menus / windows directly:
if (isFeatureOn('BetaMenu')) {
  // …
}
```

### 2. Preload

```js
import { exposeToggly } from '@ops-ai/electron-feature-flags-toggly/preload'

exposeToggly()
```

Wire this file as `webPreferences.preload` with `contextIsolation: true`.

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
| Preload | `@ops-ai/electron-feature-flags-toggly/preload` |
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
