# SolidJS feature flags

`@ops-ai/solid-feature-flags-toggly` provides native SolidJS browser feature flags. Use it with [Toggly](https://toggly.io) or with local defaults. A feature flag chooses which behavior is shown without a new application deployment. UI gates do not replace server authorization.

## Installation

```sh
npm install @ops-ai/solid-feature-flags-toggly solid-js
```

Requires SolidJS 1.9+ and Node 22.12+ for tooling. Configure Vite with `vite-plugin-solid`; the package exports preserved JSX through the `solid` condition, so the consumer compiles it with the same Solid runtime. Browsers need Fetch, AbortController and WebCrypto for signed definitions. This package's supported rendering surface is client rendering; SolidStart server rendering is not supported by this version.

## Provider and declarative gates

```tsx
import { Feature, TogglyProvider } from '@ops-ai/solid-feature-flags-toggly';

export default function App() {
  return <TogglyProvider config={{
    appKey: import.meta.env.VITE_TOGGLY_APP_KEY,
    environment: 'Production',
    flagDefaults: { 'new-dashboard': false },
    identity: 'alice', groups: ['staff'], claims: { role: 'admin' },
  }}>
    <Feature feature="new-dashboard" loading={<p>Loading…</p>}
      fallback={<p>Classic dashboard</p>}><p>New dashboard</p></Feature>
    <Feature feature={['new-dashboard', 'api-v2']} requirement="all">Both enabled</Feature>
    <Feature feature={['new-dashboard', 'api-v2']} requirement="any">Either enabled</Feature>
    <Feature feature="new-dashboard" negate>Dashboard disabled</Feature>
  </TogglyProvider>;
}
```

Configuration is read once when the provider is created. Change targeting using `client.setContext`; changing the config prop does not reconfigure a running provider. App keys are browser-visible identifiers; never supply a management credential. Missing keys evaluate false. Empty key lists evaluate true before negation. Feature children and fallback are lazy Solid branches: an expensive or `lazy()` component is instantiated only when its branch is selected. While a request runs, `Feature` shows its `loading` branch (empty by default).

## Reactive and programmatic API

```tsx
import { createSignal, Suspense } from 'solid-js';
import { useFeatureFlag, useFeatureFlags, useToggly } from '@ops-ai/solid-feature-flags-toggly';

function Dashboard() {
  const [key] = createSignal('new-dashboard');
  const enabled = useFeatureFlag(key); // also accepts a fixed string
  const definitions = useFeatureFlags(); // raw boolean/entity-gate definitions
  const toggly = useToggly();
  return <>
    <p>{enabled() ? 'Enabled' : 'Disabled'}</p>
    <button onClick={() => toggly.client.refresh()}>Refresh</button>
    <Suspense fallback={<p>Loading definitions…</p>}>
      <pre>{JSON.stringify(toggly.resource())}</pre>
    </Suspense>
    <pre>{JSON.stringify(definitions())}</pre>
    <p>{toggly.error()?.message}</p>
  </>;
}
```

`useFeatureFlag` returns a memoized boolean accessor, so downstream computations run when that result changes. `useToggly().evaluate(keys, requirement?, negate?, entity?)` is synchronous and reactive within a Solid computation. `loading`, `error`, and `flags` are accessors. `resource` integrates initial fetching with Suspense; later manual/live refreshes are observed through `flags` and `loading`. Failures expose `error()` and retain same-context last-known definitions or configured defaults; the resource resolves the fallback rather than throwing.

For an owner without context, call `createToggly(config)` within a component or `createRoot`. Owner disposal unsubscribes, aborts HTTP and closes timers/sockets automatically. `createClient(config)` is the lower-level non-reactive instance API: explicitly call `refresh`, `start` and `dispose`, and use `subscribe` to observe state. There is no global client.

## Identity and targeting

```ts
await toggly.client.setContext({ identity: 'alice', groups: ['staff'], claims: { role: 'admin' } });
await toggly.client.setContext({ identity: '', groups: [], claims: {} }); // explicit clear
```

Omitted fields preserve the current value; empty values clear it. Initial targeting is copied, and each provider owns its session. A change clears previous identity results before fetching; older in-flight responses cannot overwrite newer results. Identity is not generated or persisted automatically. Group, percentage and claim rules are evaluated remotely. Browser country, language and device rules reflect the real network/browser request; a demo cannot impersonate these by changing claims.

## Entity and local gates

```tsx
const order = { kind: 'Order', key: 'ord-vip', attributes: { Vip: true } };
const enabled = useFeatureFlag('ExpressCheckout', () => order);
<Feature feature="ExpressCheckout" entity={order}>Express checkout</Feature>;

let deviceReady = false;
toggly.client.setLocalGates([
  { id: 'device-ready', flagKeys: ['api-v2'], isEnabled: () => deviceReady },
]);
deviceReady = true;
toggly.client.notifyLocalGatesChanged();
```

Pass a complete `TogglyEntityContext` explicitly; this SDK does not register process-wide entity mappers. Toggly returns entity conditions with evaluated definitions and the shared evaluator resolves them against `attributes`. Entity gates without context fail closed. Local gates AND their value with the evaluated result, so they can disable but cannot independently enable a remote-disabled feature. Notify after non-reactive device state changes; a local gate reading a Solid signal is tracked during evaluation. A flag cannot belong to two different local gates.

## Defaults and failure behavior

```tsx
<TogglyProvider config={{ flagDefaults: { 'new-dashboard': true } }}>
  <Feature feature="new-dashboard">Offline preview</Feature>
</TogglyProvider>
```

Without an app key, the client performs no definitions requests and uses defaults. The SDK never invents a key. Applications should display a visible configuration banner when live mode is expected.

## Signed definitions, cache and live updates

Signature verification defaults to **true**. The shared client verifies ES256 evaluated-signed responses using the service JWKS before applying booleans or entity gates. Configure `allowedKeyIds` to constrain trusted keys and `maxSignatureAgeSeconds` to reject old envelopes. Set `verifySignatures: false` only for explicitly unsigned development fixtures.

Each client keeps a same-context in-memory snapshot and conditional HTTP revision. Persistent caching is opt-in: pass `storage: window.localStorage` in browser-only code. Cache keys include the base URL, app, environment and complete targeting URL. Only signed raw envelopes are persisted, and startup reads reverify signatures and freshness. Unavailable storage, corrupt data and invalid signatures never enable cached flags. Verified cached envelopes still require JWKS retrieval for a newly created client; no guarantee is made for a cold start with no network at all. Storage retains identity-bearing cache keys; choose its lifecycle to match your privacy requirements.

On mount, live WebSocket updates are enabled by default and coalesced for 300 ms. Revision notifications trigger a pinned HTTP fetch; revisions are accepted only after HTTP confirmation. Signing-key changes clear JWKS. Connections retry after 5 seconds and polling remains a fallback. Use `enableLiveUpdates: false` to disable sockets, `refreshInterval: 0` to disable polling, or `connectTimeout` to set request timeout (10,000 ms default). Polling defaults to 180,000 ms. `baseURI` defaults to `https://definitions.toggly.io`; `environment` defaults to `Production`. `fetch` can inject a transport for tests. No variant assignment, usage metrics or analytics hook API is exposed by this package; a boolean fallback is not an experiment assignment.

## Development

```sh
npm ci
npm run typecheck
npm run build
npm run test:coverage
npm pack --dry-run
```

Tests cover real WebCrypto envelopes and tampering, cache failures, identity races, fine-grained rendering, lazy children, Suspense, live notifications and disposal. See the [complete SolidJS sample](https://github.com/ops-ai/Toggly.Samples/tree/main/solidjs-sdk) for the interactive workshop and app setup.

## License

MIT. [Documentation](https://docs.toggly.io/sdks/javascript/solid) · [Toggly](https://toggly.io).
