# @ops-ai/toggly-client-core

Framework-agnostic feature flag evaluation for browsers, server runtimes, and
edge workers. Browser-aware bundlers select the package's browser condition;
Node and edge imports retain the portable entry and do not create frontend
telemetry resources.

## Browser telemetry

As of **0.5.1**, automatic checks retain the context of the flags actually
selected for evaluation, including when an entity mapper changes identity or a
refresh completes after a context change. Disposing the owner prevents a captured
check from sending while preserving the feature result.

Introduced in **0.5.0** using `@ops-ai/toggly-client-telemetry@^1.1.0`.
Frontend telemetry is enabled by
default in browsers when `appKey` is set. It is disabled for portable
server/edge imports, missing keys, or `enableTelemetry: false`.

```ts
import { createTogglyClient } from '@ops-ai/toggly-client-core';

const client = createTogglyClient({
  appKey: 'your-app-key',
  environment: 'Production',
  enableTelemetry: true,
  enableUsageTracking: true,
  enableMetrics: true,
  metricsBaseUrl: 'https://metrics.toggly.io',
  telemetryFlushIntervalMs: 45_000,
});

// getFlag records the effective enabled/disabled result once. Fetching the
// complete flags snapshot does not count as a feature evaluation.
await client.getFlag('NewCheckout');

// Explicit events do not evaluate a feature.
client.recordUsage('NewCheckout');
client.recordView('NewCheckout', 'experiment-a');
client.incrementCounter('orders', 1);
client.setGauge('cartValue', 19.5);
await client.flushTelemetry();

// Cleanup is synchronous and starts one bounded best-effort final flush.
// Await flushTelemetry first to drain queued work on a best-effort basis.
client.dispose();
```

`enableUsageTracking` controls automatic checks plus explicit usage/view
events. `enableMetrics` independently controls counters and gauges. The
telemetry endpoint is independent of `baseURI`. Definitions query parameters
are never copied onto the metrics URL. Optional body fields `i` (minted
`instanceId`) and `u` (client `identity` when `instanceId` is absent) are the
only attribution sent with a batch; groups, claims, and authentication are
never added.
Invalid telemetry-only configuration produces a bounded diagnostic and does
not change feature evaluation.

Browser page hiding and page exit use an uncompressed keepalive flush. Regular
flushes prefer gzip. A client owns one reporter, its browser listeners, its
definition requests, websocket reconnect work, and telemetry lifecycle. Call
`dispose()` before discarding a client. Multiple clients remain independent by
application key and environment.

Bundlers that do not honor the package `browser` export condition can import
`@ops-ai/toggly-client-core/browser` explicitly. SSR, workers, and trusted
server code should keep importing `@ops-ai/toggly-client-core`.

## Initial targeting context

Initial targeting context was added in 0.4.0.

```ts
import { createTogglyClient } from '@ops-ai/toggly-client-core';

const client = createTogglyClient({
  appKey: 'your-app-key',
  environment: 'Production',
  identity: 'user-123', // Targeting display name.
  instanceId: 'minted-instance', // Opaque token from POST /api/frontend/identities.
  groups: ['beta'], // Used only when instanceId is absent.
  claims: { plan: 'pro' },
});
const flags = await client.getFlags();
```

All targeting values reach the first request, avoiding an intermediate anonymous fetch.
The client copies identity, groups, claims, and `instanceId` at creation. Call
`setContext(...)` to replace them on the same owner; admitted telemetry keeps
its previous `i`/`u`. When `instanceId` is set, definitions use `?i=` and omit
`u`/`g`/`claim.*`. An omitted identity remains anonymous; empty groups or claims
add no memberships or attributes. Up to 20 nonempty claims are sent in
deterministic key order; group whitespace is trimmed. Mint `instanceId` from a
Backend application key; do not mint in the browser.
Flag fetches use
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
