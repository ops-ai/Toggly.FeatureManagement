# @ops-ai/toggly-client-core

Framework-agnostic Toggly client for feature flag evaluation. Flag fetches use
`${baseURI}/evaluated-signed/${appKey}/${environment}` (default base
`https://definitions.toggly.io`).

This is a **standalone** client for generic JavaScript and Workers. The
Docusaurus plugin bundles its own fetch, and the Cloudflare templates in this
repo call the definitions endpoint directly — neither depends on this package.

## Install

```bash
npm install @ops-ai/toggly-client-core
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../../README.md)

## Entity context

Pass a domain object on each `getFlag` call. User identity is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Entity & page context](https://docs.toggly.io/docs/core-concepts/entity-context).

```ts
client.registerContext('Doc', (doc) => ({
  kind: 'Doc',
  key: String(doc.id),
  attributes: { Section: doc.section },
}));

await client.getFlag('NewCallout', false, doc, 'Doc');
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
