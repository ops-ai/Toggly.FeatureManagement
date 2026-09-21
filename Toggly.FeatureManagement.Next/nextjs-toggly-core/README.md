# @ops-ai/nextjs-toggly-core

Core feature flag functionality for Next.js

## Install

```bash
npm install @ops-ai/nextjs-toggly-core
```

Optional gRPC transport (Node/server only):

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

Import gRPC helpers from `@ops-ai/nextjs-toggly-core/telemetry/grpc` — do not
import that subpath from Edge bundles.

## Browser telemetry

Use `@ops-ai/nextjs-toggly-core/browser` for a typed browser client. Browser-aware
bundlers also select this entry from the root import. The default Node entry retains
trusted telemetry semantics, and `/telemetry/grpc` remains Node-only. Browser
bundles contain the compact frontend reporter.

```ts
import { createTogglyClient } from '@ops-ai/nextjs-toggly-core/browser'

const client = createTogglyClient({
  appKey: 'your-app-key',
  environment: 'Production',
  enableTelemetry: true, // browser default with an app key
  metricsBaseUrl: 'https://metrics.toggly.io', // separate from definitions baseUri
  telemetryFlushIntervalMs: 45000, // integer from 30000 through 60000
})
await client.init()
client.telemetry.recordUsage('Checkout') // default variant: enabled
client.telemetry.recordView('Checkout', 'control')
client.telemetry.incrementCounter('orders', 2)
client.telemetry.setGauge('cartSize', 3)
await client.telemetry.flushTelemetry()
client.destroy() // synchronous, bounded best-effort final flush
```

Automatic checks record actual effective outcomes after entity/local gates and
before negation, retaining short circuiting. Cached public checks count again;
definition hydration and refresh snapshots do not. The existing Boolean feature
variant components use enabled/disabled labels. Usage and views are always explicit.
Counters sum nonnegative integer deltas; gauges retain the latest finite
nonnegative value. Metrics are app-level.

Browser payloads contain only app/environment, feature/variant counts, and numeric
metrics. They exclude identity, groups, claims, entity data, timestamps, instance
names, and feature-attributed business metrics. Requests omit credentials and use
browser gzip when available. Memory, payload size, request timeout and retries are
bounded; page hiding and destruction trigger best-effort flushing. SSR/build,
keyless clients and `enableTelemetry: false` create no frontend reporter resources.
Invalid flush intervals use 45000 ms. Invalid collector URLs disable telemetry
without changing evaluations; use absolute HTTP(S) without credentials, query, or
fragment.

### Legacy browser calls

Legacy signatures retain their meaning: `recordUsage(feature, identity?, variant?)`
and `recordView(feature, identity?, variant?)` still reserve the second argument
for identity. Browser forwarding discards identity and uses only the third variant;
use the compact companion for the two-argument feature/variant form.

Browser legacy `incrementCounter(metric, value, options?)` forwards an app-level
counter and omits feature/variant attribution with a bounded diagnostic.
`measure` and `observe` retain their signatures but are unsupported in browsers:
they emit no data and report bounded, payload-free diagnostics through `onError`.
Accumulating measures and timestamped observations cannot be represented by the
compact wire contract. Choose `telemetry.incrementCounter` or
`telemetry.setGauge` according to your intended metric semantics. Server/edge
measure, counter, observation, attribution and identity behavior remains unchanged.

Explicit `enableUsageTracking: false` disables browser checks/usage/views;
`enableMetrics: false` disables browser business metrics. `enableTelemetry: false`
disables both. Trusted flush interval options do not configure the browser reporter.
Reinitialization disposes the previous reporter without relabeling queued events;
identity refresh on the same owner preserves queued metrics.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call. User identity is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Next.js SDK](https://docs.toggly.io/sdks/nextjs/).

```ts
client.registerContext('Product', (product) => ({
  kind: 'Product',
  key: String(product.id),
  attributes: { Category: product.category },
}))

await client.isFeatureOn('NewBadge', product, 'Product')
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
