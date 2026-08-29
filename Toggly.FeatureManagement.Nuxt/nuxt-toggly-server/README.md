# @ops-ai/nuxt-toggly-server

Server-side feature flag utilities for Nuxt with Nitro support

## Install

```bash
npm install @ops-ai/nuxt-toggly-server
```

## Live updates

By default, `initServerToggly` enables WebSocket live updates (`enableLiveUpdates:
true`) and injects the `ws` package as `webSocketImpl`, while keeping
`refreshInterval: 0` (no HTTP polling). Pass `enableLiveUpdates: false` to
disable. Edge/short-lived runtimes skip sockets in core.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
