# @ops-ai/nuxt-toggly-core

Core feature flag utilities for Nuxt

## Install

```bash
npm install @ops-ai/nuxt-toggly-core
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call. `setContext` is the user, not the page entity. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Nuxt entity context](https://docs.toggly.io/sdks/javascript/nuxt#entity-context).

```ts
client.registerContext('Puppy', (puppy) => ({
  kind: 'Puppy',
  key: String(puppy.id),
  attributes: { Color: puppy.color },
}))

await client.isFeatureOn('PuppyBadge', puppy, 'Puppy')
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
