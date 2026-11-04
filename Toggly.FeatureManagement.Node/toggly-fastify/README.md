# @ops-ai/toggly-fastify

Toggly feature flags Fastify plugin

## Install

```bash
npm install @ops-ai/toggly-fastify
```

## Compatibility

The adapter retains its `fastify` peer range of `^4.0.0 || ^5.0.0` and its
Node.js package floor of 22. Upstream still publishes Fastify 4 (`four`
dist-tag, currently 4.29.1) and Fastify 5 (`latest`, currently 5.12.7); CI
proves both majors on Node 22, 24, and 26.

The compatibility harness packs the release artifact, resolves its core
dependency from npm, type-checks its public declarations, exercises ESM and
CommonJS exports, and starts real HTTP listeners. To provide exact Node
binaries in a local matrix, set `TOGGLY_FASTIFY_NODE_FASTIFY4` and
`TOGGLY_FASTIFY_NODE_FASTIFY5` before `pnpm test:hosts`.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
