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
import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { createRequire } from 'node:module'
import {
  initToggly,
  registerTogglyIpc,
  attachTogglyLifecycle,
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
attachTogglyLifecycle(app, powerMonitor)

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

Hooks use `defaultValue` until their first committed evaluation and expose `isReady`.
Abandoned renders and StrictMode effect replay do not send duplicate checks.
Changed definitions, local gates or evaluation inputs recompute; unchanged
snapshot notifications do not. `refresh()` explicitly evaluates again.

## Usage and business metrics

Telemetry defaults on when the main client has an application key. Configure
`enableTelemetry: false` to opt out, `metricsBaseUrl` for an independent base
URL (an explicit path is preserved), or `telemetryFlushIntervalMs` (30000–60000;
default 45000, with 20% scheduling jitter). Invalid intervals fall back to 45000;
invalid URLs disable reporting without breaking flag evaluation. Main-only
`telemetryFetch` and `onTelemetryDiagnostic` support independent transport and
bounded payload-free diagnostics.

The main client owns one reporter shared by its windows. Renderer/preload/React
never create a transport. Checks record the effective leaf after entity/local
gates and before aggregate negation, preserving short circuiting. Cached direct
reads count; definitions loading and snapshot reads alone do not. Usage/view
remain explicit, including in React components:

```ts
import {recordUsage, recordView, incrementCounter, setGauge, flushTelemetry}
  from '@ops-ai/electron-feature-flags-toggly/renderer'
recordUsage('Checkout')             // variant defaults to "enabled"
recordView('Cart', 'blue')
incrementCounter('orders', 2)
setGauge('cartItems', 3)
await flushTelemetry()
```

These methods are also available on the main client, `/main`, `/react` and
`window.toggly`. Variants are 1–64 ASCII letters/digits/underscore/hyphen.
Counters use nonnegative integer deltas; gauges use finite nonnegative values,
up to 1000000 per call. Metrics are app-level bare names. Payloads contain only
application/environment, aggregate checks/usage/views and business metrics;
identity, claims, groups and entity data are excluded. Ordinary native requests
use Node gzip and omit credentials and Origin. No browser lifecycle or network
library is included in renderer code.

New telemetry IPC handlers accept only the exact top-level frame of a live
window returned by `getWindows`; they reject unlisted windows, subframes,
extra arguments, invalid types/variants/numeric bounds and keys over 1024 UTF-16
code units. Renderers cannot set telemetry configuration or destination.
Provide the window list shown above to enable these methods. Legacy flag and
context IPC authorization behavior with an omitted list remains unchanged;
those payloads are now bounded/validated (gates up to 2000 keys, contexts up to
2000 values/eight levels and a conservative 16KiB string budget).

Attach `attachTogglyLifecycle(app, powerMonitor)` once after each initialization.
It flushes on window blur, all windows closing and native suspend. On normal
app quit it closes the owner first, initiates one plain final envelope with no
retry, then lets quit continue within five seconds. `closeToggly()` and
`client.close()` remain synchronous best-effort cleanup; use awaitable
`flushTelemetry()` when deterministic completion is needed before shutdown.
Closing one window does not dispose another's owner. Reinitialization closes
the previous owner and removes its IPC/lifecycle listeners; register the new
owner's IPC and lifecycle again. The registration functions return detach
callbacks. Forced process termination cannot guarantee delivery. Telemetry is
never written to the feature disk cache.

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
- `registerTogglyIpc(ipcMain, getWindows)` / `attachTogglyLifecycle(app, powerMonitor?)`
- `recordUsage` / `recordView` / `incrementCounter` / `setGauge` / `flushTelemetry`

### Renderer (`window.toggly`)

- `isFeatureOn(key, entityContext?, kind?)`
- `evaluateFeatureGate(keys, requirement?, negate?, entityContext?, kind?)`
- `getFlags()` / `setContext` / `clearContext`
- `onFlagsUpdated(callback)` → unsubscribe

## Configuration

| Option | Default | Notes |
|--------|---------|--------|
| `enableTelemetry` | `true` with app key | Shared main-process reporter |
| `metricsBaseUrl` | `https://metrics.toggly.io` | Independent metrics base URL |
| `telemetryFlushIntervalMs` | `45000` | 30000–60000ms, jittered |
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
