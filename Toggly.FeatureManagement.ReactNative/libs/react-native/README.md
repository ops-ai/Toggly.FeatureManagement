# @ops-ai/react-native-toggly

Feature flags SDK for React Native and Expo applications. Provides hooks, context, and components for feature flag management. Can be used with or without Toggly.io.

## Install

```bash
npm install @ops-ai/react-native-toggly
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).

## Frontend telemetry

Telemetry is enabled by default when `appKey` is configured. Set `enableTelemetry: false` to disable collection and transport; clients without an app key remain silent. `metricsBaseUrl` defaults to `https://metrics.toggly.io` and is independent of the definitions endpoint. It must be an absolute HTTP(S) base URL without credentials, query, or fragment. `telemetryFlushIntervalMs` defaults to 45000 ms and accepts 30000–60000 ms, with ±20% scheduling jitter. Invalid values use the default.

Each actual feature evaluation records its effective enabled/disabled leaf after entity and local gates, preserving short circuit and aggregate negation. Refreshes and snapshot projections alone do not record checks. Rendering does not imply usage or a view: call `recordUsage(featureKey, variant?)` or `recordView(featureKey, variant?)` explicitly. Optional variants must be 1–64 ASCII letters, digits, underscores, or hyphens; they label the explicit event and do not assign a feature variant.

`incrementCounter(name, delta = 1)` and `setGauge(name, value)` are app-level metrics. `flushTelemetry()` is awaitable and contains transport failures. `onTelemetryDiagnostic` receives bounded diagnostic codes. Payloads contain only the app/environment, compact feature counts, and metric values; identity, entity attributes, claims, and definitions request headers are not sent.

One Core owner holds a bounded in-memory queue. AppState background/inactive triggers a best-effort flush; synchronous `dispose()` retires the owner and attempts at most one final envelope. Queue contents are not persisted by storage adapters. Native fetch uses gzip when runtime compression is available and plain JSON otherwise, without browser lifecycle APIs or a synthesized Origin header. No delivery is guaranteed during process termination.

Use the same methods from `useToggly()` and pass telemetry options to `TogglyProvider`. Changing the app key, environment, definitions base URI, telemetry opt-out, collector URL, or flush interval creates a new owner and remounts its child tree. Other configuration is captured on mount; identity updates remain supported through the identity prop. Use a React `key` to replace the owner for other configuration changes.

```tsx
const { recordUsage, incrementCounter, flushTelemetry } = useToggly();
function onCheckout() {
  recordUsage('checkout');
  incrementCounter('orders');
}
// Await only when the application explicitly needs a flush boundary.
await flushTelemetry();
```
