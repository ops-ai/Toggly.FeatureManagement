# @ops-ai/react-router-toggly

Toggly feature flags for **React Router 7/8 framework mode**. One package with
`./client` and `./server` entry points. Core evaluation and telemetry live
in-source (not published as a separate package).

> Migrating from `@ops-ai/remix-toggly-*`? Those packages are deprecated. Install
> `@ops-ai/react-router-toggly` and import from `/client` and `/server`.


## Browser telemetry

`TogglyProvider` and `RouterTogglyProvider` each own one compact browser reporter.
With an app key, telemetry is enabled by default. Access explicit events through
`useToggly()` or `useTogglyContext()`:

```tsx
const toggly = useToggly()
// Call these from application actions or an explicit view event.
toggly.recordUsage('Checkout')
toggly.recordView('Checkout', 'control')
toggly.incrementCounter('orders', 2)
toggly.setGauge('cartSize', 3)
await toggly.flushTelemetry()
```

Usage and view variants default to `enabled`; labels contain 1–64 ASCII letters,
digits, underscores or hyphens. Counters sum nonnegative integer deltas, and gauges
retain the latest finite nonnegative value. A single value cannot exceed 1,000,000.
Metrics are app-level and contain no feature attribution.

Automatic checks record each evaluated feature after local and entity gates,
before negation. Short-circuited keys do not count. Direct cached reads, hooks and
components count actual evaluations; hydration and refresh snapshots alone do
not. Rendering never implicitly records usage or views. Boolean A/B helpers use
enabled/disabled check labels; explicit events may specify a variant label.

Provider `config` accepts `enableTelemetry` (default true), `metricsBaseUrl`
(default `https://metrics.toggly.io`), and `telemetryFlushIntervalMs` (30000–60000 ms,
default 45000). Set `enableTelemetry: false` to disable browser telemetry.
`enableUsageTracking: false` disables checks/usage/views, and `enableMetrics: false`
disables business metrics. Invalid intervals use the default. Invalid collector
URLs disable telemetry without changing feature results; use absolute HTTP(S)
URLs without credentials, query or fragment.

SSR/build, keyless and opted-out providers create no frontend reporter resources.
Payloads contain only app/environment, feature/variant counts and numeric metrics;
they exclude identity, claims, groups, entity data and timestamps. Requests omit
credentials, use native gzip when available, and have bounded buffers, timeout
and retries. Page hiding and unmount trigger a bounded best-effort flush; await
`flushTelemetry()` for deterministic completion before navigation when needed.

Each mounted provider is independent. App/environment replacement releases the
old reporter without relabeling its queue, and ignores loader snapshots explicitly
labeled for another owner. StrictMode effect replay preserves the committed owner;
real unmount releases it and remount creates a fresh one. Browser telemetry does
not change trusted server loader/action metrics or their existing APIs.

## Install

```bash
npm install @ops-ai/react-router-toggly react-router react react-dom
```

Peers: `react-router ^7 || ^8`, `react` / `react-dom ^18 || ^19`. Optional:
`@react-router/node`. Requires Node `>=18`.

## Quick start

### Server loader

```ts
// app/toggly.server.ts
import { createTogglyLoader } from '@ops-ai/react-router-toggly/server';

export const toggly = createTogglyLoader({
  appKey: process.env.TOGGLY_APP_KEY!,
  environment: process.env.TOGGLY_ENVIRONMENT ?? 'Production',
  getIdentity: async (request) => {
    // Resolve session identity for this request
    return null;
  },
});
```

```tsx
// app/root.tsx
import { Outlet } from 'react-router';
import { RouterTogglyProvider } from '@ops-ai/react-router-toggly/client';
import { toggly } from './toggly.server';

export async function loader(args: { request: Request }) {
  return toggly.getLoaderData(args);
}

export default function App() {
  return (
    <RouterTogglyProvider routeId="root">
      <Outlet />
    </RouterTogglyProvider>
  );
}
```

### Client gates

```tsx
import { Feature, useFeature } from '@ops-ai/react-router-toggly/client';

export default function Home() {
  const beta = useFeature('Beta');
  return (
    <Feature feature="Checkout">
      <Checkout />
      {beta ? <BetaBanner /> : null}
    </Feature>
  );
}
```

### Feature-gated actions

```ts
import { createFeatureGatedAction } from '@ops-ai/react-router-toggly/server';

export const action = createFeatureGatedAction(
  {
    appKey: process.env.TOGGLY_APP_KEY!,
    requiredFeatures: 'AdminTools',
  },
  async () => ({ ok: true }),
);
```

## Exports

| Subpath | Purpose |
|---------|---------|
| `@ops-ai/react-router-toggly/client` | `RouterTogglyProvider`, hooks, `Feature` components |
| `@ops-ai/react-router-toggly/server` | Loaders, actions, `TogglyServerClient` |

Server-only modules (`ws`, gRPC telemetry) must not be imported from client code.

## Development

```bash
npm install
npm run build
npm test
npm run test:coverage
npm run test:hosts   # packed RR7/RR8 hosts (needs matching Node majors)
```

## License

MIT
