# @ops-ai/toggly-node-core

Core Toggly feature flags SDK for Node.js - zero browser dependencies

## Install

```bash
npm install @ops-ai/toggly-node-core
```

### Usage + business metrics (optional gRPC)

Feature usage (`Usage.SendStats`) and business metrics (`Metrics.SendMetrics`)
are batched in-process and sent over native gRPC. Install the optional transport
packages when you want telemetry to leave the process:

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

Without those packages, flag evaluation still works; usage/metrics recording is
a no-op (a warning is logged when telemetry is enabled).

| Option | Default | Notes |
|--------|---------|--------|
| `enableUsageTracking` | `true` when `appKey` is set | Auto-records checks on `isFeatureOn` |
| `enableMetrics` | `true` when `appKey` is set | `measure` / `incrementCounter` / `observe` |
| `metricsBaseUrl` | `https://app.toggly.io/` | gRPC host (separate from definitions `baseUrl`) |
| `usageFlushInterval` / `metricsFlushInterval` | `60000` | ms; `0` disables the timer |
| `instanceName` / `appVersion` | unset | Included on wire payloads |

```ts
const client = createTogglyClient({
  appKey: '…',
  enableUsageTracking: true,
  enableMetrics: true,
})
await client.init()

await client.isFeatureOn('Checkout') // records a check when usage is enabled
client.recordUsage('Checkout')
client.recordView('Checkout')
client.measure('checkout_value', 42.5, { feature: 'Checkout' })
client.incrementCounter('checkout_started')
client.observe('queue_depth', 3)

await client.flushTelemetry() // optional; also runs on close / SIGTERM
await client.close()
```

gRPC metadata includes `UA` from `sdk-identity` (`toggly-node/<version>`).

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- [Entity context (Node)](https://docs.toggly.io/sdks/nodejs#entity-context)
- SDK catalog: [root README](../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call (after optional user `EvaluationContext`). `setContext` / identity is the user, not the page entity.

`registerContext(kind, mapper, schema?)` maps domain objects locally **and** registers entity schemas with Toggly on startup (`registerContextsOnStartup`, default true). Node is the SDK that PUTs schemas; browser/edge clients do not.

Entity gates fail closed without context. See [Entity context (Node)](https://docs.toggly.io/sdks/nodejs#entity-context).

```ts
client.registerContext(
  'Order',
  (order) => ({
    kind: 'Order',
    key: String(order.id),
    attributes: { Status: order.status },
  }),
  { keyProperty: 'id', properties: [{ name: 'color', type: 'string' }] },
)

await client.isFeatureOn('OrderBadge', undefined, order, 'Order')
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
