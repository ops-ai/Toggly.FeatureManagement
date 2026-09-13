# @ops-ai/nextjs-toggly-edge

Edge Runtime feature flags for Next.js - Middleware and Edge Functions

## Install

```bash
npm install @ops-ai/nextjs-toggly-edge
```

## Next.js 16 Proxy

Next.js 16 deprecates the `middleware.ts` file convention in favor of a
Node.js-runtime `proxy.ts`. Use `createFeatureProxy` when the application runs
on that convention. The handler evaluates the feature with the request's
identity, groups, claims, cookies, and headers; it does not mutate the legacy
middleware client between requests.

```ts
// proxy.ts
import { createFeatureProxy } from '@ops-ai/nextjs-toggly-edge'

export const proxy = createFeatureProxy({
  config: {
    appKey: process.env.TOGGLY_APP_KEY!,
    environment: 'Production',
  },
  feature: {
    featureKey: 'beta-feature',
    redirectTo: '/coming-soon',
  },
})

export const config = { matcher: ['/beta/:path*'] }
```

Proxy is Node.js-only in Next 16. Keep using the existing
`createFeatureMiddleware` from `middleware.ts` when an application requires
the retained Edge runtime. Both APIs use the same feature-gate options and
request-local evaluation.

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
