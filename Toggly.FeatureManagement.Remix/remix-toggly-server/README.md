# @ops-ai/remix-toggly-server

Server-side utilities for Toggly Remix SDK - loaders, actions, and server utilities

## Install

```bash
npm install @ops-ai/remix-toggly-server
```

For gRPC usage/metrics transport (recommended on Node), also install the optional peers:

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Usage + business metrics

When `appKey` is set, the server client enables usage and metrics telemetry by
default (gRPC when optional deps are installed). Disable with
`enableUsageTracking: false` / `enableMetrics: false`, or set
`TOGGLY_DISABLE_TELEMETRY=1` (authoritative).

```ts
const client = createServerClient({ appKey: '…', environment: 'Production' })
await client.init()
await client.isEnabled('NewCheckout') // auto recordCheck when usage enabled
client.recordUsage('NewCheckout')
client.measure('checkout_revenue', 42, { feature: 'NewCheckout' })
await client.flushTelemetry()
```

Edge / serverless adapters without gRPC can set
`telemetryTransport: 'https'` and `telemetryAttachProcessHandlers: false`.

Browser `@ops-ai/remix-toggly-client` does not send this telemetry.

## Entity context

`createTogglyLoader` / `createTogglyAction` expose `isEnabled(featureKey, defaultValue)` only — they do **not** accept entity context. Those helpers fail closed for entity-gated keys (no context is passed).

Pass entity on the raw `TogglyClient`: `client.isEnabled(key, userContext, defaultValue, entity, kind)`. User identity on the server client is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Hydrated flags keep `EntityGate` objects so the client can evaluate with per-widget context.

See [Remix server SDK](https://docs.toggly.io/sdks/remix/server).

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
