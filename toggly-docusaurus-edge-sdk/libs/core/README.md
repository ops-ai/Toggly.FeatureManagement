# @ops-ai/toggly-client-core

## Initial targeting context

Requires **0.4.0 (release pending)**. This API is not yet available in the published 0.3.0 package.

```ts
import { createTogglyClient } from '@ops-ai/toggly-client-core';

const client = createTogglyClient({
  appKey: 'your-app-key',
  environment: 'Production',
  identity: 'user-123', // Stable user identifier.
  groups: ['beta'], // Memberships used by targeting rules.
  claims: { plan: 'pro' }, // String attributes used by targeting rules.
});
const flags = await client.getFlags();
```

All targeting values reach the first request, avoiding an intermediate anonymous fetch.
The client copies groups and claims at creation; create a new client for another
context. Each client owns its evaluated cache. An omitted identity remains anonymous;
empty groups or claims add no memberships or attributes. Up to 20 nonempty claims
are sent in deterministic key order; group whitespace is trimmed.


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
