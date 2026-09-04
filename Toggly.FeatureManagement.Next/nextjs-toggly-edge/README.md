# @ops-ai/nextjs-toggly-edge

Edge Runtime feature flags for Next.js - Middleware and Edge Functions

## Install

```bash
npm install @ops-ai/nextjs-toggly-edge
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Evaluation model

The edge package fetches **`definitions-signed`** (shared, identity-agnostic)
and evaluates filters **per request** with overrides from headers/cookies
(`x-toggly-identity` / `toggly-identity`, User-Agent, country headers, etc.).

Do **not** assign `client.identity` on the shared singleton from concurrent
middleware — pass overrides into `isFeatureOn` / `evaluateFeatureGate` (or use
the built-in middleware helpers, which already do this).

For multi-tenant or entity-gated pages, prefer evaluating in
`@ops-ai/nextjs-toggly-server` with per-call `context` / `contextKind`, or pass
entity context into the edge helpers when you have it.

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
