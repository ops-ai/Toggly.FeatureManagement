# SolidJS feature flags

`@ops-ai/solid-feature-flags-toggly` provides native SolidJS browser feature flags. Use it with [Toggly](https://toggly.io) or with local defaults. A feature flag chooses which behavior is shown without a new application deployment. UI gates do not replace server authorization.

## Installation

```sh
npm install @ops-ai/solid-feature-flags-toggly solid-js
```

Requires SolidJS 1.9+ and Node 22.12+ for tooling. Configure Vite with `vite-plugin-solid`; the package exports preserved JSX through the `solid` condition, so the consumer compiles it with the same Solid runtime. Browsers need Fetch, AbortController and WebCrypto for signed definitions. For Node-hosted SSR, use the [SolidStart integration](https://docs.toggly.io/sdks/javascript/solidstart) with its separate Node-only server entrypoint, signed public snapshots and reactive hydration.

## Provider and declarative gates

```tsx
import { Feature, TogglyProvider } from '@ops-ai/solid-feature-flags-toggly';

export default function App() {
  return (
    <TogglyProvider
      config={{
        appKey: import.meta.env.VITE_TOGGLY_APP_KEY,
        environment: 'Production',
        flagDefaults: { 'new-dashboard': false },
        identity: 'alice',
        groups: ['staff'],
        claims: { role: 'admin' },
      }}
    >
      <Feature
        feature="new-dashboard"
        loading={<p>Loading…</p>}
        fallback={<p>Classic dashboard</p>}
      >
        <p>New dashboard</p>
      </Feature>
      <Feature feature={['new-dashboard', 'api-v2']} requirement="all">
        Both enabled
      </Feature>
      <Feature feature={['new-dashboard', 'api-v2']} requirement="any">
        Either enabled
      </Feature>
      <Feature feature="new-dashboard" negate>
        Dashboard disabled
      </Feature>
    </TogglyProvider>
  );
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
  return (
    <>
      <p>{enabled() ? 'Enabled' : 'Disabled'}</p>
      <button onClick={() => toggly.client.refresh()}>Refresh</button>
      <Suspense fallback={<p>Loading definitions…</p>}>
        <pre>{JSON.stringify(toggly.resource())}</pre>
      </Suspense>
      <pre>{JSON.stringify(definitions())}</pre>
      <p>{toggly.error()?.message}</p>
    </>
  );
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
<Feature feature="ExpressCheckout" entity={order}>
  Express checkout
</Feature>;

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

Each client keeps a same-context in-memory snapshot and conditional HTTP revision. Persistent caching is opt-in: supply the application's storage adapter. The SDK stores the exact signed envelope with the public key that verified it. A fresh client rechecks the signature, current key pins, key metadata/expiry, configured signature age and complete entity schema before restoring definitions, without a network key fetch. Refresh still attempts the service; an offline error leaves the verified restored flags usable. With no matching valid record, defaults remain active.

```ts
const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
// Use in browser configuration; the callbacks defer storage access until refresh.
const client = createClient({ appKey: 'your-frontend-app-key', storage });
await client.refresh();
```

Signed SSR snapshots and values already accepted from the network or verified storage take precedence over persisted records. Restore runs only while the current context has defaults; changing context or hydrating a `source: 'defaults'` snapshot makes its matching cache eligible again. A `source: 'signed'` snapshot remains authoritative during offline refresh.

Cache records are partitioned by endpoint, app, environment and complete targeting URL. Signing-key notifications retire all stored targeting records for that endpoint before refreshing. Corrupt/unsupported records and inaccessible storage cannot enable cached flags or prevent network recovery. If retirement cannot be written, that client stops using persistence for its lifetime; restoring storage access or clearing the affected storage is the application's responsibility before a later restart.

Storage is application/origin-owned local trust material. A party able to replace both stored keys and envelopes can replace that trust anchor unless you independently configure `allowedKeyIds`. Signature verification is repeated on every restore; a signed timestamp floor rejects rollback within a running context. Detecting rollback of the entire store after process loss requires external protected state. `maxSignatureAgeSeconds` limits how old a persisted envelope may be at restart; unset/nonpositive values disable the age limit. Future timestamps and expired keys are rejected. Storage keys include identity/groups/claims; clear or partition storage according to your application's privacy and logout policy. Caching definitions does not make application HTML, assets or server queries available offline.

Set `expose` to restrict browser definitions to an explicit list of public keys. A server snapshot supplies its own allowlist, which also applies to subsequent refreshes. Every fetch uses `cache: 'no-store'`; polling sends its explicit confirmed ETag, while revisionless invalidations omit validators.

On mount, live WebSocket updates are enabled by default and coalesced for 300 ms. Revision notifications trigger a pinned HTTP fetch; revisions are accepted only after HTTP confirmation. Signing-key changes clear JWKS. Connections retry after 5 seconds and polling remains a fallback. Use `enableLiveUpdates: false` to disable sockets, `refreshInterval: 0` to disable polling, or `connectTimeout` to set request timeout (10,000 ms default). Polling defaults to 180,000 ms. `baseURI` defaults to `https://definitions.toggly.io`; `environment` defaults to `Production`. `fetch` can inject a transport for tests. The browser entrypoint exposes no variant assignment, usage metrics or analytics hook API; a boolean fallback is not an experiment assignment.

## Development

```sh
npm install
npm run typecheck
npm run build
npm run test:coverage
npm pack --dry-run
```

Tests cover real WebCrypto envelopes and tampering, cache failures, identity races, fine-grained rendering, lazy children, Suspense, live notifications and disposal. See the [complete SolidJS sample](https://github.com/ops-ai/Toggly.Samples/tree/main/solidjs-sdk) for the interactive workshop and app setup.

## SolidStart

Use `@ops-ai/solid-feature-flags-toggly` with SolidStart 2 and Node 24+. The browser entrypoint provides native Solid gates and accessors. The Node-only `/server` entrypoint reuses the Toggly Node client for backend evaluation and builds a separately verified public snapshot for server rendering.

```sh
npm install @ops-ai/solid-feature-flags-toggly solid-js
```

Use separate backend and frontend application keys. The backend key and full definitions remain on the server. Only explicitly exposed frontend definitions and deliberately projected public targeting are serialized. Feature gates control rollout behavior; authenticate and authorize requests separately.

## Create a server scope

Put this code in `src/lib/toggly.server.ts`. Keep its imports behind server queries, actions or API handlers. Initialize one backend client for the process, then create a new request wrapper for each operation.

```ts
import { createTogglyClient, createTogglyRequest } from '@ops-ai/solid-feature-flags-toggly/server';
import type { EvaluationContext } from '@ops-ai/solid-feature-flags-toggly/server';

const backend = createTogglyClient({
  appKey: process.env.TOGGLY_BACKEND_APP_KEY,
  environment: 'Production',
  verifySignatures: true,
  enableFileCache: false,
  featureDefaults: { 'enhanced-submit': false },
});
const initialized = backend.init();
process.once('SIGTERM', () => {
  void backend.close();
});

export async function requestScope(request: Request, principal: EvaluationContext) {
  await initialized;
  return createTogglyRequest({
    client: backend,
    request,
    context: principal,
    // Explicit public projection: omit private claims and session credentials.
    clientContext: { identity: principal.identity, groups: principal.groups },
    frontend: {
      appKey: process.env.VITE_TOGGLY_APP_KEY,
      environment: 'Production',
      expose: ['new-dashboard', 'ExpressCheckout'],
      flagDefaults: { 'new-dashboard': false },
    },
  });
}
```

The wrapper copies context once and passes it to each shared-core evaluation. It never calls `setIdentity` on the shared client. Omitted identity evaluates as an empty identity, preventing inheritance of a process-wide default identity. `request` supplies User-Agent and Accept-Language; trusted server code can supply `context.request.country` explicitly. Do not accept a client-controlled country header as a trusted geolocation assertion. A server snapshot fetch originates from your server, so IP-derived country rules can differ from later browser refreshes.

`clientContext` defaults to empty. It is independent of backend context. `frontend.appKey` must differ from the backend client's app key. Application configuration must ensure it is a real frontend key; the adapter cannot infer key type from arbitrary strings. Missing frontend key uses the explicitly allowlisted defaults without a network call.

## Server query and hydration

Create `src/lib/flags.ts` with a SolidStart server query. Replace the demonstration principal with your authenticated session lookup.

```ts
import { query } from '@solidjs/router';
export const getFlags = query(async () => {
  'use server';
  const { getRequestEvent } = await import('solid-js/web');
  const { requestScope } = await import('./toggly.server');
  const scope = await requestScope(getRequestEvent()!.request, { identity: 'demo-user' });
  try {
    return await scope.snapshot();
  } finally {
    scope.dispose();
  }
}, 'public-toggly-flags');
```

Then render a route using the query result. SolidStart serializes its server query result; do not manually insert JSON into script tags.

```tsx
import { createAsync } from '@solidjs/router';
import { Show } from 'solid-js';
import { Feature, TogglyProvider } from '@ops-ai/solid-feature-flags-toggly';
import { getFlags } from '../lib/flags';

export default function Home() {
  const snapshot = createAsync(() => getFlags());
  return (
    <Show when={snapshot()}>
      {(initial) => (
        <TogglyProvider
          snapshot={snapshot() ?? initial()}
          config={{
            appKey: import.meta.env.VITE_TOGGLY_APP_KEY,
            environment: 'Production',
          }}
        >
          <Feature
            feature="new-dashboard"
            loading={<p>Refreshing…</p>}
            fallback={<p>Classic dashboard</p>}
          >
            <p>New dashboard</p>
          </Feature>
        </TogglyProvider>
      )}
    </Show>
  );
}
```

The snapshot initializes signals synchronously for matching server HTML and browser hydration. Browser transport starts on mount. A changed `snapshot` prop replaces definitions, allowlist and public context, aborts older fetches and refreshes the new targeting. For session changes, invalidate or revalidate the server query using your router's data lifecycle; do not reuse a cached principal's query result after logout. The [full sample](https://github.com/ops-ai/Toggly.Samples/tree/main/solidstart-sdk) uses a query argument to demonstrate route-dependent targeting.

`createToggly(config, snapshot)` and `createClient(config, snapshot)` accept the same initial snapshot. `useToggly().hydrate(snapshot)` applies an updated server result directly. The low-level client's `hydrate` replaces state but does not trigger fetching; call `refresh` yourself when using it outside the provider. Configuration other than targeting/allowlist is fixed for a provider's lifetime. Remount the provider when switching application, environment or endpoint.

Snapshots are trusted application-provided SSR state, not portable signed credentials. `snapshot()` verifies the frontend response before projecting its definitions; it does not serialize the original signed envelope or backend definitions. Obtain snapshots from your server query. Never hydrate arbitrary user-supplied JSON. If authoring a manual inline script, `serializeSnapshot(snapshot)` escapes script-breaking characters and applies the allowlist again.

## Evaluation and server guards

```ts
const scope = await requestScope(request, principal);
try {
  const on = await scope.isEnabled('new-dashboard');
  const any = await scope.evaluate(['new-dashboard', 'api-v2'], { requirement: 'any' });
  const standard = await scope.evaluate(['ExpressCheckout'], {
    negate: true,
    entity: { kind: 'Order', key: 'ord-1', attributes: { Vip: false } },
  });
  await scope.requireFeature('enhanced-submit');
  // Run the rollout-controlled server operation here.
} finally {
  scope.dispose();
}
```

`requireFeature(string | string[], options?)` throws a generic `Response` with status 404 when disabled. Return that response from an API handler or let your framework handle it. Options support `requirement: 'all' | 'any'`, `negate` and explicit `entity`. The same options apply to `evaluate`; `isEnabled(key, entity?)` evaluates one key. Backend filters, identity/groups/claims, entity rules, refresh and caching use the shared [Node core](https://docs.toggly.io/sdks/nodejs). The process owner closes that client on shutdown. `dispose()` aborts only this request's frontend fetch and prevents further wrapper operations; it never closes the shared backend client.

## Signatures, defaults and lifecycle

Frontend snapshots always verify ES256 signatures; there is no server snapshot option to disable verification. `frontend` accepts `baseURI`, `environment`, `allowedKeyIds`, `maxSignatureAgeSeconds`, `timeout` (10 seconds by default), `fetch` and `onError`. Set allowed keys and freshness limits to match your security policy. Invalid signatures, unavailable JWKS, malformed results and transport errors return only allowlisted defaults with `source: 'defaults'`; successful verification returns `source: 'signed'`. A disposed/aborted request rejects. Each wrapper memoizes one snapshot fetch and returns defensive copies. There is no cross-request frontend snapshot cache.

Browser `storage` supports the same signed offline-restart behavior described above. It does not cache SolidStart server queries or application HTML/assets; a fully offline page launch requires an application-owned offline shell.

Browser refreshes independently verify signed responses. Every browser fetch uses `cache: 'no-store'`; polling explicitly supplies its last confirmed ETag, while revisionless live invalidations omit validators. This prevents native browser caching from quietly adding stale validators. Same-context network/signature failures retain the previous verified flags. A new request snapshot replaces prior identity state immediately. Unmounting the provider aborts pending HTTP and clears polling, reconnect/debounce timers and sockets. See the [SolidJS API](https://docs.toggly.io/sdks/javascript/solid) for local gates, resources, all/any/negate and lazy components.

`VITE_` variables are public build-time values and require rebuilding when changed. Backend variables are server runtime values. Keep the Node-only entrypoint out of client modules. This integration targets Node-hosted SolidStart; it does not claim edge or static-export backend evaluation support.

## License

MIT. [Documentation](https://docs.toggly.io/sdks/javascript/solid) · [Toggly](https://toggly.io).
