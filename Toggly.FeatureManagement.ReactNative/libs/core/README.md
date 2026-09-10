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
service.registerContext('Order', (order) => ({
  kind: 'Order',
  key: String(order.id),
  attributes: { Status: order.status },
}));

await service.isFeatureOn('OrderBadge', order, 'Order');
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).

### Initial targeting context

The initialization race fix requires core **1.7.4** (release pending). The existing
configuration fields are also forwarded by `TogglyProvider`.

```ts
const toggly = new TogglyService({
  appKey: 'your-app-key',
  environment: 'Production',
  identity: 'user-123', // A stable identifier for the signed-in user.
  groups: ['beta'], // Membership used by group targeting rules.
  claims: { plan: 'pro' }, // String attributes used by targeting rules.
});
await toggly.init(); // The first request includes all three targeting fields.
```

Supply known targeting at construction rather than calling `setContext` after
initialization: this avoids an intermediate request with incomplete targeting.
The SDK copies groups and claims immediately, so caller edits during asynchronous
storage reads cannot change the initial request. When identity is omitted or empty,
the existing persisted-device identity fallback is retained. Concurrent refreshes
while initialization is running share that initialization result. Native foreground
and reconnect events before initialization do not start requests.
