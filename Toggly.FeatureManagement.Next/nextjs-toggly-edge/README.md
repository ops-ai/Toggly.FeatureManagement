# @ops-ai/nextjs-toggly-edge

Edge Runtime feature flags for Next.js - Middleware and Edge Functions

## Install

```bash
npm install @ops-ai/nextjs-toggly-edge
```

## Telemetry

Edge uses gateway HTTPS JSON (`api/usage/stats`, `api/metrics`) — not Node
gRPC. When `appKey` is set, usage/metrics default on (disable with config or
`TOGGLY_DISABLE_TELEMETRY=1`). Call `flushTelemetry()` or `scheduleFlush(waitUntil)`
at the end of a request; there are no process signal handlers on Edge.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
