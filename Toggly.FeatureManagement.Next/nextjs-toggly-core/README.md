# @ops-ai/nextjs-toggly-core

Core feature flag functionality for Next.js

## Install

```bash
npm install @ops-ai/nextjs-toggly-core
```

Optional gRPC transport (Node/server only):

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

Import gRPC helpers from `@ops-ai/nextjs-toggly-core/telemetry/grpc` — do not
import that subpath from Edge bundles.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call. User identity is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Next.js SDK](https://docs.toggly.io/sdks/nextjs/).

```ts
client.registerContext('Product', (product) => ({
  kind: 'Product',
  key: String(product.id),
  attributes: { Category: product.category },
}))

await client.isFeatureOn('NewBadge', product, 'Product')
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
