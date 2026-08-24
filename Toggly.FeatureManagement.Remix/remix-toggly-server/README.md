# @ops-ai/remix-toggly-server

Server-side utilities for Toggly Remix SDK - loaders, actions, and server utilities

## Install

```bash
npm install @ops-ai/remix-toggly-server
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

`createTogglyLoader` / `createTogglyAction` expose `isEnabled(featureKey, defaultValue)` only — they do **not** accept entity context. Those helpers fail closed for entity-gated keys (no context is passed).

Pass entity on the raw `TogglyClient`: `client.isEnabled(key, userContext, defaultValue, entity, kind)`. User identity on the server client is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Hydrated flags keep `EntityGate` objects so the client can evaluate with per-widget context.

See [Remix server SDK](https://docs.toggly.io/sdks/remix/server).

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
