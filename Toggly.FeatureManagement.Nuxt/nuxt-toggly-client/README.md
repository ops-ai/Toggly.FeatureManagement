# @ops-ai/nuxt-toggly-client

Client-side feature flag composables and components for Nuxt/Vue 3

## Install

```bash
npm install @ops-ai/nuxt-toggly-client
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).

## SSR and hydration

Nuxt module 1.2.0 supplies an isolated Vue provider per SSR request, then hydrates
its evaluated flags in the browser. `getTogglyClient()` is a browser convenience;
on the server, retain the instance returned by `createToggly()` or use the
provided `useToggly()` instance. Ordinary uninitialized gates keep their loading
behavior; a ready hydration snapshot can render boolean gates synchronously.

## Frontend telemetry

Configured browser clients send compact feature checks and
app-level metrics by default. SSR projection, refresh projection, keyless
clients, and server rendering remain silent. Configure the independent browser
transport through `enableTelemetry`, `metricsBaseUrl`, and
`telemetryFlushIntervalMs` (30–60 seconds). Existing
`enableUsageTracking: false` and `enableMetrics: false` settings opt out of
their respective categories.

```ts
const toggly = createToggly({
  appKey: 'your-app-key',
  metricsBaseUrl: 'https://metrics.toggly.io',
})

toggly.telemetry.recordUsage('checkout', 'blue')
toggly.telemetry.recordView('checkout')
toggly.telemetry.incrementCounter('checkout-completed')
toggly.telemetry.setGauge('cart-items', 3)
await toggly.telemetry.flushTelemetry()
```

The legacy `recordUsage(feature, identity?, variant?)` and `recordView`
signatures are unchanged; browser forwarding uses only the
third argument as the variant. The second per-call identity is not used for
attribution; the owner supplies optional `i` (host-provided `instanceId`) or `u`
(identity, including a generated identity). Use `setContext` to rotate context;
queued records retain their original attribution. Legacy browser `measure` and `observe` calls are
unsupported payload-free no-ops with bounded diagnostics. Migrate accumulating
whole-number values to `telemetry.incrementCounter` and current values to
`telemetry.setGauge`.

Browser identity changes clear an omitted token. Failed refreshes retain the new
context and matching cache/defaults. Persisted feature bodies and validators are
scoped together by context and response mode, bounded to eight snapshots per
route/mode. SSR hydration and ordinary refresh projection remain check-free;
pending consumer checks cannot overwrite a newer projection or unmounted UI.
