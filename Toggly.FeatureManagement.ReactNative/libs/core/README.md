# @ops-ai/react-native-toggly-core

Core feature flag logic for React Native applications. Framework-agnostic, minimal dependencies. Can be used with or without Toggly.io.

## Install

```bash
npm install @ops-ai/react-native-toggly-core
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call. User identity is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Entity & page context](https://docs.toggly.io/docs/core-concepts/entity-context).

```ts
service.registerContext('Order', (order) => ({
  kind: 'Order',
  key: String(order.id),
  attributes: { Status: order.status },
}));

await service.isFeatureOn('OrderBadge', order, 'Order');
```

## Frontend telemetry

Telemetry is enabled by default when `appKey` is configured. Set `enableTelemetry: false` to disable collection and transport; clients without an app key remain silent. `metricsBaseUrl` defaults to `https://metrics.toggly.io` and is independent of the definitions endpoint. It must be an absolute HTTP(S) base URL without credentials, query, or fragment. `telemetryFlushIntervalMs` defaults to 45000 ms and accepts 30000–60000 ms, with ±20% scheduling jitter. Invalid values use the default.

Each actual feature evaluation records its effective enabled/disabled leaf after entity and local gates, preserving short circuit and aggregate negation. Refreshes and snapshot projections alone do not record checks. Rendering does not imply usage or a view: call `recordUsage(featureKey, variant?)` or `recordView(featureKey, variant?)` explicitly. Optional variants must be 1–64 ASCII letters, digits, underscores, or hyphens; they label the explicit event and do not assign a feature variant.

`incrementCounter(name, delta = 1)` and `setGauge(name, value)` are app-level metrics. `flushTelemetry()` is awaitable and contains transport failures. `onTelemetryDiagnostic` receives bounded diagnostic codes. Payloads contain only the app/environment, compact feature counts, and metric values; identity, entity attributes, claims, and definitions request headers are not sent.

One Core owner holds a bounded in-memory queue. AppState background/inactive triggers a best-effort flush; synchronous `dispose()` retires the owner and attempts at most one final envelope. Queue contents are not persisted by storage adapters. Native fetch uses gzip when runtime compression is available and plain JSON otherwise, without browser lifecycle APIs or a synthesized Origin header. No delivery is guaranteed during process termination.

```ts
service.recordUsage('checkout');
service.recordView('checkout', 'variant-a');
service.incrementCounter('orders');
service.setGauge('cart_value', 42.5);
await service.flushTelemetry();
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).

### Initial targeting context

The initialization race fix requires core **1.7.4** (release pending). The existing
configuration fields are also forwarded by `TogglyProvider`.

```ts
const toggly = new TogglyService({
  appKey: 'your-app-key',
  environment: 'Production',
  identity: 'user-123', // A stable identifier for the signed-in user.
  groups: ['beta'], // Membership used by group targeting rules.
  claims: { plan: 'pro' }, // String attributes used by targeting rules.
});
await toggly.init(); // The first request includes all three targeting fields.
```

Supply known targeting at construction rather than calling `setContext` after
initialization: this avoids an intermediate request with incomplete targeting.
The SDK copies groups and claims immediately, so caller edits during asynchronous
storage reads cannot change the initial request. When identity is omitted or empty,
the existing persisted-device identity fallback is retained. Concurrent refreshes
while initialization is running share that initialization result. Native foreground
and reconnect events before initialization do not start requests.
