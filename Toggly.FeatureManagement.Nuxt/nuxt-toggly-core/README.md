# @ops-ai/nuxt-toggly-core

Core feature flag utilities for Nuxt

## Install

```bash
npm install @ops-ai/nuxt-toggly-core
```

## Live updates

WebSocket live updates are enabled when `enableLiveUpdates` is unset or true
(browser, Node with `globalThis.WebSocket`, or an injected `webSocketImpl`).
Edge runtimes skip long-lived sockets. Pass `webSocketImpl` from the `ws`
package on Node 18 when no global WebSocket exists (done automatically by
`@ops-ai/nuxt-toggly-server`).

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## Entity context

Pass a domain object on each `isFeatureOn` / `evaluateFeatureGate` call. `setContext` is the user, not the page entity. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. See [Nuxt SDK](https://docs.toggly.io/sdks/nuxt/).

```ts
client.registerContext('Order', (order) => ({
  kind: 'Order',
  key: String(order.id),
  attributes: { Status: order.status },
}))

await client.isFeatureOn('OrderBadge', order, 'Order')
```

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
