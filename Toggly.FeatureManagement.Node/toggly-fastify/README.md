# @ops-ai/toggly-fastify

Toggly feature flags Fastify plugin

## Install

```bash
npm install @ops-ai/toggly-fastify
```

## Compatibility

The adapter retains its `fastify` peer range of `^4.0.0 || ^5.0.0` and its
Node.js package floor of 18. Fastify 4.29.1 is tested with Node 18.20.8.
Fastify 5 requires Node 20 or newer; Fastify 5.12.4 is tested with Node
20.19.6. Use a Fastify-5-compatible Node runtime even though the adapter
itself can run on Node 18.

The compatibility harness packs the release artifact, resolves its core
dependency from npm, type-checks its public declarations, exercises ESM and
CommonJS exports, and starts real HTTP listeners. To provide exact Node
binaries in a local matrix, set `TOGGLY_FASTIFY_NODE18` and
`TOGGLY_FASTIFY_NODE20` before `pnpm test:hosts`.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
