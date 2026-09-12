# Toggly SvelteKit SDK

Request-scoped server feature flags and signed SSR hydration for SvelteKit. Use with Toggly.io or explicit offline defaults. A feature flag selects an application branch without deploying new code; targeting rules can vary that branch by user, request or entity.

## Install and requirements

```sh
npm install @ops-ai/toggly-sveltekit
```

Svelte 5, SvelteKit 2, Node 22.12+ and adapter-node. Uses Node core0.9.1+ and signed-defs1.2.6+. Browser signature verification needs WebCrypto (HTTPS or localhost). Other server adapters need separate validation.

## Server hook

```ts
// src/hooks.server.ts — keep backend keys in server-only modules.
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createTogglyClient, createTogglyHandle } from '@ops-ai/toggly-sveltekit/server';
const client = createTogglyClient({
  appKey: env.TOGGLY_APP_KEY,
  environment: env.TOGGLY_ENVIRONMENT ?? 'Production',
  verifySignatures: true,
  featureDefaults: { 'new-dashboard': false },
});
await client.init();
process.once('SIGTERM', () => { void client.close(); });
export const handle = createTogglyHandle({
  client,
  context: () => ({ identity: '', groups: [], claims: {} }),
  frontend: {
    appKey: publicEnv.PUBLIC_TOGGLY_APP_KEY,
    environment: publicEnv.PUBLIC_TOGGLY_ENVIRONMENT ?? 'Production',
    expose: ['new-dashboard', 'ExpressCheckout'],
    featureDefaults: { 'new-dashboard': false },
  },
});
```

Use your authenticated session in `context(event)`; identity, groups, claims and request fields are copied once. The hook captures User-Agent, Accept-Language and cf-ipcountry; callback request fields may override them. Never set identity on the process-wide Node client from request handling.

`clientContext(event, context)` explicitly projects public identity/groups/claims into the frontend snapshot. Omitted means anonymous frontend targeting. Never expose private session claims or credentials. The frontend key must be a Front-end App Key generated in App Settings. Flags must be Available to Client SDK and local browser origins allowed.

## Load and hydrate

Return `await loadToggly(event)` from `+layout.server.ts` as `toggly`, plus your public key/environment. Do not return the server client. The snapshot fetch verifies signatures and exposes only listed frontend flag keys, retaining entity gates.

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createToggly } from '@ops-ai/toggly-sveltekit';
  import Feature from '@ops-ai/toggly-sveltekit/Feature.svelte';
  import type { LayoutData } from './$types';
  export let data: LayoutData;
  const toggly = createToggly(data.toggly, { appKey: data.publicKey, environment: data.environment });
  $: toggly.update(data.toggly);
  onMount(() => { void toggly.start(); });
  onDestroy(() => toggly.dispose());
</script>
<Feature {toggly} feature="new-dashboard">
  <p>New dashboard</p><p slot="fallback">Classic dashboard</p>
</Feature>
<slot />
```

Synchronous initialization selects the same SSR and hydration branch. `update(snapshot)` handles new server data after navigation/login/logout and rejects prior session completions. Invalidate your server load when authentication changes. This instance has no global Svelte stores.

## API

| Surface | Behavior |
| --- | --- |
| `createToggly(snapshot, options)` | Creates a synchronous Svelte readable store and evaluation methods |
| `isEnabled(key, { entity, defaultValue })` | Browser boolean; missing default false; entity gate without entity fails closed |
| `gate(keys, { requirement, negate, entity, defaultValue })` | all/any, optional negation; empty gate true before negation |
| `start()` / `update(snapshot)` / `dispose()` | Browser refresh lifecycle, context replacement, cleanup |
| `notifyLocalGatesChanged()` | Notify reactive readers after a local prerequisite changes |
| `event.locals.toggly.isEnabled(key, { entity })` | Async request-bound Node evaluation using configured defaults |
| `event.locals.toggly.gate(keys, { requirement, negate, entity })` | Async request-bound composite gate |
| `loadToggly(event)` | One verified, allowlisted frontend fetch per request |
| `requireFeature(event, keys, options)` | Throws HTTP404 on a failed server gate; suitable for loads/actions |

Pass explicit entities: `{ kind: 'Order', key: 'ord-vip', attributes: { Vip: true } }`. The Node core owns rule evaluation; shared entity/local-gate packages own browser gate evaluation. No evaluator is duplicated here. Boolean branches are not A/B experiment assignment; variant assignment is not exposed.

## Refresh and failures

Browser options include `appKey`, `environment`, `baseURI`, `allowedKeyIds`, `maxSignatureAgeSeconds`, `refreshInterval` (180000ms; zero disables polling), `enableLiveUpdates` (default true), `timeout` (5000ms), `localGates` and `onError`. Signatures are always verified. The adapter reconnects WebSockets and fetches on update messages. Disposal stops polling/sockets and prevents late publication.

Matching SSR/verified snapshots survive failed browser refreshes. Optional signed storage can also restore definitions after a fresh offline restart. Parsed-flag caches are never trusted. New server requests use explicit exposed defaults on frontend fetch/verification failure. Backend defaults/cache behavior is controlled by the supplied Node client. No key is a supported offline mode. `frontend.onError` reports failed snapshot fetches.

Local gates use `{ id, flagKeys, isEnabled }`; they AND with remote values and cannot enable a remotely disabled flag. Keep initial local gate state identical for SSR/hydration.

Prerender produces build-time defaults/snapshots, not per-user server evaluation or actions. Personalized routes require a running adapter-node server. Presentation gates supplement authentication/authorization; they do not replace either.

## Development

```sh
npm install
npm run build
npm run test:coverage
npx playwright install chromium
npm run test:host
```

The [SvelteKit sample](https://github.com/ops-ai/Toggly.Samples/tree/develop/sveltekit-sdk) includes a real adapter-node host, filter matrix and browser smoke tests. [Full guide](https://docs.toggly.io/sdks/javascript/sveltekit). MIT license. [Toggly](https://toggly.io).


## Persistent signed definitions

Pass an optional `storage` adapter to browser configuration to restore matching definitions after a fresh process or browser restart without fetching signing keys:

```ts
const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};
const toggly = createToggly(data.toggly, { appKey: data.publicKey, storage });
```

These callbacks defer browser storage access until `start()` runs after mounting. The adapter stores a versioned exact signed envelope and only the public key that verified it. It partitions records by endpoint, app, environment and complete identity/groups/claims URL. Restore rechecks the current key pins, public-key constraints/expiry, signature age and complete entity schema before publishing; it never trusts a parsed-flag cache or fetches a URL supplied by a stored record. Failed storage access, corrupt data and verification failure leave defaults or already verified state intact.

`loadToggly` marks its fallback snapshot `source: 'defaults'`, allowing a fresh browser store to restore the matching signed record before the network attempt. A successful server snapshot carries `source: 'signed'`, its verified `signedTimestamp` and selected public `signingKey`. These are trusted host hydration metadata, not portable signed credentials: no raw backend definitions or signed envelope are serialized. Browser `allowedKeyIds` also applies before signed SSR values seed the UI. Older stored state never replaces signed SSR or live state. The layout retains observed key trust across navigation; current observed keys take precedence over stored keys. Manual snapshots without source metadata remain authoritative; explicitly label application defaults `source: 'defaults'` when they may be replaced by a verified cache.

Signature timestamps cannot move backwards within a running layout/context. Signing-key notifications replace the in-memory key-cache instance and retire historical stored contexts through an endpoint generation marker. If retirement cannot be saved, the client stops using persistence for that session; repair storage access or clear affected storage before a later restart.

Storage is application/origin-owned local trust material. A party able to replace both stored keys and envelopes can replace that trust anchor unless independent `allowedKeyIds` pins constrain it. Detecting rollback of the entire store after process loss needs external protected state and is not promised. `maxSignatureAgeSeconds` is rechecked on restore; unset/nonpositive values disable age expiry. Future timestamps and expired keys are rejected. Storage keys contain targeting data, so apply the application's privacy/logout lifecycle.

Definition persistence does not provide cached HTML/assets, offline server loads or actions. A full offline page launch needs an application-owned offline shell. A server-side snapshot failure still returns only the explicit exposed defaults.
