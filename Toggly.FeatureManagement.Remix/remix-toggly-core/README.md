# @ops-ai/remix-toggly-core

Core types and utilities for Toggly Remix SDK - shared between server and client packages

## Install

```bash
npm install @ops-ai/remix-toggly-core
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

`isFeatureEnabled` / gate helpers accept optional entity context. User identity (`IdentityContext`) is separate from page-entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Entity & page context](https://github.com/ops-ai/toggly_docs/blob/develop/docs/01-core-concepts/entity-context.mdx).

```ts
registerContext('Puppy', (puppy) => ({
  kind: 'Puppy',
  key: String(puppy.id),
  attributes: { Color: puppy.color },
}))
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
