# @ops-ai/nextjs-toggly-server

Server-side feature flags for Next.js - Server Components, Server Actions, and Route Handlers

## Install

```bash
npm install @ops-ai/nextjs-toggly-server
```

For usage/metrics gRPC transport (optional):

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

## Telemetry

When `appKey` is set, feature usage and business metrics are enabled by default
(disable with `enableUsageTracking: false` / `enableMetrics: false`, or
`TOGGLY_DISABLE_TELEMETRY=1`). Checks via `isServerFeatureOn` / the shared
client record usage; call `recordServerUsage` / `measureServerMetric` /
`flushServerTelemetry` as needed. Transport is native gRPC to
`metricsBaseUrl` (default `https://app.toggly.io/`).

## Next.js 16 Cache Components

`cachedIsFeatureOn`, `cachedEvaluateFeatureGate`, and `cachedGetFeatures`
continue to use Next's `unstable_cache` API for retained Next 14/15 apps and
Next 16 apps that have not enabled Cache Components. With Next 16
`cacheComponents: true`, read request data such as `headers()` outside a
`'use cache'` scope and pass the resolved identity or request context to the
Toggly helper. This keeps a cached result partitioned by the request context
instead of sharing one user's gate with another.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
