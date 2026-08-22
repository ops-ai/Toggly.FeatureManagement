# @ops-ai/toggly-node-core

Core Toggly feature flags SDK for Node.js - zero browser dependencies

## Install

```bash
npm install @ops-ai/toggly-node-core
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- [Entity context (Node)](https://docs.toggly.io/sdks/nodejs#entity-context)
- SDK catalog: [root README](../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call (after optional user `EvaluationContext`). `setContext` / identity is the user, not the page entity.

`registerContext(kind, mapper, schema?)` maps domain objects locally **and** registers entity schemas with Toggly on startup (`registerContextsOnStartup`, default true). Node is the SDK that PUTs schemas; browser/edge clients do not.

Entity gates fail closed without context. See [Entity context (Node)](https://docs.toggly.io/sdks/nodejs#entity-context).

```ts
client.registerContext(
  'Order',
  (order) => ({
    kind: 'Order',
    key: String(order.id),
    attributes: { Status: order.status },
  }),
  { keyProperty: 'id', properties: [{ name: 'color', type: 'string' }] },
)

await client.isFeatureOn('OrderBadge', undefined, order, 'Order')
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
