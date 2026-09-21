# @ops-ai/nextjs-toggly-client

Client-side feature flags for Next.js - React hooks and Client Components

## Install

```bash
npm install @ops-ai/nextjs-toggly-client
```

## Browser telemetry

The provider owns one browser client and shares its compact telemetry companion
with hooks and components. Access it from `useToggly()`:

```tsx
'use client'
import { useToggly } from '@ops-ai/nextjs-toggly-client'

export function CheckoutButton() {
  const { telemetry } = useToggly()
  return <button onClick={() => {
    telemetry.recordUsage('Checkout')
    telemetry.incrementCounter('orders')
  }}>Checkout</button>
}
```

`telemetry.recordView(feature, variant = 'enabled')`,
`telemetry.setGauge(metric, value)`, and `await telemetry.flushTelemetry()` complete
the compact API. Rendering never records usage or views. Boolean checks from hooks
and components record effective local/entity outcomes once per recomputation,
including cached initial flags. Short-circuited keys do not count. Boolean variant components use the enabled/disabled
outcome of their feature; explicit usage/view calls may supply a variant label.

Provider configuration forwards `enableTelemetry` (default on with an app key),
`metricsBaseUrl` (default `https://metrics.toggly.io`), and
`telemetryFlushIntervalMs` (30000-60000 ms, default 45000).
SSR/build, keyless and opted-out clients remain silent. Telemetry is credential-free
and contains no user identity, groups, claims or entity attributes.
`enableUsageTracking: false` disables checks/usage/views and `enableMetrics: false`
disables business metrics. Each provider has its own owner; changing app/environment
replaces it without carrying over the old reactive snapshot or queued labels.
StrictMode replay keeps the active owner, while real unmount releases its resources
and makes a bounded final flush. Remount creates a fresh owner.

Legacy methods remain on `client`. Their usage/view second argument is identity,
not variant; browser forwarding only uses the third variant. Browser legacy counter
attribution is omitted with bounded diagnostics. Legacy `measure` and `observe`
are unsupported in the browser and emit no metrics; use the compact counter or
latest-value gauge API with the intended semantics. See the
[core browser contract](../nextjs-toggly-core/README.md#browser-telemetry) for details.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
