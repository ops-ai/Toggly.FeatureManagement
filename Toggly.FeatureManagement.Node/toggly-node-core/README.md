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
| `enableUsageTracking` | `true` when `appKey` is set | Auto-records checks on `isFeatureOn` / `evaluateFeatureGate` |
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
await client.evaluateFeatureGate(['Checkout', 'Beta'], 'any') // records per feature
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

## Feature variants (catalog-local, MF-parity)

`getVariant` / `getVariantValue` assign a variant from cached definitions
entirely locally — no server round trip, no dual-rail dependency on an
`evaluated-variants` endpoint. The allocation algorithm
(`@ops-ai/toggly-eval`'s `allocateVariant`) replays
`Microsoft.FeatureManagement`'s own variant-assignment logic bit-for-bit
(user → group → percentile → default, `statusOverride`, SHA-256 percentile
hashing), verified against the shared gold corpus at
`variant-allocator-corpus/cases.json` (repo root).

```ts
const variant = await client.getVariant('checkout-flow', { identity: 'alice' })
// { name: 'A', configurationValue: { color: 'blue' } } | null

const value = await client.getVariantValue('checkout-flow', { identity: 'alice' })
// { color: 'blue' } | null

type Checkout = { color: string }
const isCheckout = (v: unknown): v is Checkout =>
  typeof v === 'object' && v !== null && typeof (v as Checkout).color === 'string'

const typed = await client.getVariantValue<Checkout>(
  'checkout-flow',
  { identity: 'alice' },
  undefined,
  undefined,
  isCheckout,
)
// Checkout | null — soft-null when missing or the guard rejects
```

`getVariant` returns `null` when the feature is unknown, disabled for this
context, or has no assignable variant — matching the `getVariant` null
contract used across the rest of the Toggly JS ecosystem
(React/Vue/Solid/Next.js/Nuxt/SvelteKit). Typed `getVariantValue<T>(…, isT?)`
soft-decodes: missing/null → `null`; with `isT` → `null` when the guard
fails; without a guard the value is returned as `T` (compile-time only).
The same policy is available as the exported `decodeVariantValue` helper.
Pass `variantIgnoreCase: true` in the client config for case-insensitive
user/group matching (`false` by default, matching
`Microsoft.FeatureManagement`'s own `TargetingEvaluationOptions.IgnoreCase`
default).

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
