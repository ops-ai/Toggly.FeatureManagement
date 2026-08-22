# @ops-ai/react-native-toggly-core

Core feature flag logic for React Native applications. Framework-agnostic, minimal dependencies. Can be used with or without Toggly.io.

## Install

```bash
npm install @ops-ai/react-native-toggly-core
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call. User identity is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Entity & page context](https://docs.toggly.io/docs/core-concepts/entity-context).

```ts
service.registerContext('Puppy', (puppy) => ({
  kind: 'Puppy',
  key: String(puppy.id),
  attributes: { Color: puppy.color },
}));

await service.isFeatureOn('PuppyBadge', puppy, 'Puppy');
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
