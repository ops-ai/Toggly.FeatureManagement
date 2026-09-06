# @ops-ai/nuxt-toggly-server

Server-side feature flag utilities for Nuxt with Nitro support

## Install

```bash
npm install @ops-ai/nuxt-toggly-server
```

For usage/metrics gRPC transport on Node/Nitro (optional):

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

## Telemetry

When `appKey` is set, feature usage and business metrics are enabled by default
(disable with `enableUsageTracking: false` / `enableMetrics: false`, or
`TOGGLY_DISABLE_TELEMETRY=1`). Checks via `isServerFeatureOn` / the shared
client record usage; call `recordServerUsage` / `measureServerMetric` /
`flushServerTelemetry` as needed.

- **Node / Nitro node-server:** native gRPC to `metricsBaseUrl` (default
  `https://app.toggly.io/`).
- **Nitro edge / Workers-like:** set `telemetryTransport: 'https'` (auto when
  `isEdgeRuntime()`), which POSTs gateway JSON to `api/usage/stats` and
  `api/metrics`. Process signal handlers are disabled on the HTTPS path.

Browser `@ops-ai/nuxt-toggly-client` is out of scope for this pipeline.

## Live updates

By default, `initServerToggly` enables WebSocket live updates (`enableLiveUpdates:
true`) and injects the `ws` package as `webSocketImpl`, while keeping
`refreshInterval: 0` (no HTTP polling). Pass `enableLiveUpdates: false` to
disable. Edge/short-lived runtimes skip sockets in core.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
