# @ops-ai/nextjs-toggly-edge

Edge Runtime feature flags for Next.js - Middleware and Edge Functions

## Install

```bash
npm install @ops-ai/nextjs-toggly-edge
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

Edge middleware has no per-request entity. Mixed `boolean | EntityGate` definitions are collapsed with `toBooleanDefinitions()` **without** entity context, so gated flags evaluate to `false` in middleware.

Evaluate entity gates in Node/server or client code (`@ops-ai/nextjs-toggly-core`) where you can pass per-eval context. See [Entity & page context](https://github.com/ops-ai/toggly_docs/blob/develop/docs/01-core-concepts/entity-context.mdx).

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
