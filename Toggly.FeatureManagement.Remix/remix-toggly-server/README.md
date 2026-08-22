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

Pass the page entity on each `isEnabled` / `evaluateGate` call (loader/action). User identity on the server client is separate. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. Hydrated flags keep `EntityGate` objects so the client can evaluate with per-widget context.

See [Remix entity context](https://docs.toggly.io/sdks/javascript/remix#entity-context).

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
