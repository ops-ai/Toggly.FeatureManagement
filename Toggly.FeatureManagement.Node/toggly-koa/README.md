# @ops-ai/toggly-koa

Toggly feature flags Koa middleware

## Install

```bash
npm install @ops-ai/toggly-koa
```

The adapter supports Koa 2 and Koa 3 on Node.js 18 or newer. TypeScript hosts
should install the matching Koa type package:

```bash
# Koa 2
npm install koa@^2 @types/koa@^2 @ops-ai/toggly-koa

# Koa 3
npm install koa@^3 @types/koa@^3 @ops-ai/toggly-koa
```

## Use

Register Toggly before any feature gates. The middleware keeps evaluation
context on `ctx.state.toggly`, so each request has its own identity and
evaluation context while the definitions client is shared.

```ts
import Koa from 'koa'
import { featureGate, togglyMiddleware } from '@ops-ai/toggly-koa'

const app = new Koa()

app.use(
  togglyMiddleware({
    appKey: process.env.TOGGLY_APP_KEY!,
    getIdentity: (ctx) => ctx.get('x-toggly-identity') || undefined,
  })
)
app.use(featureGate({ featureKey: 'new-checkout' }))
```

`verifySignatures` remains opt-in and rejects malformed signed definitions
without applying them. Call `closeKoaToggly()` during application shutdown to
close the shared client.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
