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

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
