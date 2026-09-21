Lightweight package that provides feature flags support for Vue.js applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/vue-feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/vue-feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply install use NPM to install this package.

```shell
$ npm i -s @ops-ai/vue-feature-flags-toggly
```

### Requirements

Supports Vue `^3.2.45`. Packed consumer builds cover the declared 3.2.45
minimum and the current Vue 3.5.42 release.

## Basic Usage (with Toggly.io)

Import the Toggly plugin in your main file.

```js
import { toggly } from "@ops-ai/vue-feature-flags-toggly";
```

Install the toggly plugin while providing your App Key & Environment name from your [Toggly application page](https://app.toggly.io). This registers the Feature component and an app-owned $toggly service. Each app has its own service; app.unmount() disposes it.

```js
app.use(toggly, {
  appKey: "your-app-key", // You can find this in app.toggly.io
  environment: "your-environment-name", // You can find this in app.toggly.io
});
```

Using this package with [Toggly](https://toggly.io) allows you to define custom feature rollouts.

Custom rollouts offers the ability to show features only to certain groups of users based on various custom rules which you can define in [Toggly](https://app.toggly.io).

In case you want to support custom feature rollouts, remember to provide an unique identity string for each user to make sure they get the same feature values on future visits.

```js
app.use(toggly, {
  appKey: "your-app-key", // You can find this in app.toggly.io
  environment: "your-environment-name", // You can find this in app.toggly.io
  identity: "unique-user-identifier", // Use this in case you want to support custom feature rollouts
});
```

Now you can start using the Feature component anywhere in your application.

```html
<Feature feature-key="firstFeature">
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']">
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="all" :negate="true">
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

Lastly, you can use the *$toggly* service to check if a feature is ON or OFF programmatically, by simply injecting it in any component.

```js
export default {
  inject: ['$toggly'],
  ...
}
```

```js
await this.$toggly.isFeatureOn('firstFeature')
```

```js
await this.$toggly.isFeatureOff('secondFeature')
```

And even evaluate a feature gate (with requirement & negate support).

```js
await this.$toggly.evaluateFeatureGate(['firstFeature', 'secondFeature'], 'any', true)
```

## Frontend telemetry

Browser clients with an app key aggregate effective feature checks automatically.
Checks respect entity context, local gates, variants, short circuiting, and negation.
A cached or reactive public evaluation counts again; internal refresh and cache
hydration do not count. Rendering a component never records a view or usage event.
SSR/build clients, keyless clients, and `enableTelemetry: false` stay silent.

```ts
app.use(toggly, {
  appKey: 'your-app-key',
  environment: 'Production',
  enableTelemetry: true, // default
  metricsBaseUrl: 'https://metrics.toggly.io', // independent of definitions baseURI
  telemetryFlushIntervalMs: 45000, // integer from 30000 through 60000
})
```

In a component, use its app's injected service:

```ts
import { inject } from 'vue'
import type { Toggly } from '@ops-ai/vue-feature-flags-toggly'

const service = inject<Toggly>('$toggly')!
service.recordUsage('Checkout') // explicit calls default to variant "enabled"
service.recordView('Checkout', 'control')
service.incrementCounter('orders', 2)
service.setGauge('cartSize', 3)
await service.flushTelemetry()
```

Explicit events do not evaluate flags. Counters sum; gauges retain the latest value.
Telemetry includes app/environment, feature/variant counts, metrics, and optional
identity attribution: a host-provided `instanceId` is sent as `i`; otherwise the
current `identity` is sent as `u`. Groups, claims and entity attributes are excluded.
The server accepts client-generated `u` only when the application enables its
default-off setting. HTTP 202 does not confirm that identity was accepted. Requests use
credential-free JSON, browser gzip when available, and bounded in-memory batching.
The reporter flushes on page hiding and makes a bounded best-effort final flush on
teardown. Invalid intervals use 45000 ms; invalid collector URLs disable telemetry
without changing feature results. Collector URLs must be absolute HTTP(S), with no
credentials, query, or fragment.

Pass `instanceId` from your trusted backend when it mints an identity. The browser
SDK never mints identities or needs a Backend key. Definitions requests with `i`
omit client identity, groups and claims; without it, existing targeting is retained.

```ts
await service.setContext({ identity: 'user-123', instanceId: mintedInstanceId })
await service.setContext({ instanceId: '' }) // clear token, use current identity
await service.setContext({ identity: '' }) // clear identity and any previous token
```

`setContext` updates only supplied fields. Supplying `identity` without `instanceId`
clears the previous token. Existing queued events retain their original attribution;
new events use the new context and share the same bounded queue. Definitions and
revisions are scoped to the context, token and response mode. Evaluated and variant
bodies remain separate; `maxCacheKeys` evicts each body's matching validator too.
Legacy cached bodies remain available, but ambiguous old validators are not reused.
Assigned variants stay in memory when persistence is disabled or unavailable.
If refresh fails, the Promise still
rejects, while the new context retains its matching cache or configured defaults;
the previous identity, token and definitions are not restored. Reinitialization
cancels pending telemetry before replacing the configuration; call
`flushTelemetry()` first if you need to await sending the old context.

The plugin owns one service per Vue app, shared by its components and composables.
The exported `togglyService` singleton remains available for standalone callers;
it is independent of plugin apps. Standalone instances created with
`new Toggly().init(options)` must call synchronous `dispose()` when their owner
ends. Use `flushTelemetry()` first when deterministic completion is needed.
Calling `init()` again replaces configuration, definitions, and background resources;
old queued events retain their original app/environment and late old loads cannot
replace the new state. A new app mount receives a fresh service.

## Device-local post-filter gates

Gate bundles of flags behind device-local master switches while rollouts stay on the worker. See **[Post-filter gates](https://docs.toggly.io/sdks/client-side/post-filter)**.

```js
import { toggly } from '@ops-ai/vue-feature-flags-toggly';

let apiRedesignEnabled = false;

app.use(toggly, {
  appKey: 'your-app-key',
  localGates: [{
    id: 'apiRedesign',
    flagKeys: ['ApiV2Checkout'],
    isEnabled: () => apiRedesignEnabled,
  }],
});

// In component setup, resolve this app's service with inject<Toggly>('$toggly').
// After changing apiRedesignEnabled, call service.notifyLocalGatesChanged().
```

## Basic Usage (without Toggly.io)

Import the Toggly plugin in your main file.

```js
import { toggly } from "@ops-ai/vue-feature-flags-toggly";
```

Install the toggly plugin while providing your default feature flags. This registers the Feature component and an app-owned $toggly service. Each app has its own service; app.unmount() disposes it.

```js
var featureDefaults = {
  firstFeature: true,
  secondFeature: false,
}

app.use(toggly, {
  featureDefaults: featureDefaults,
});
```

Now you can start using the Feature component anywhere in your application.

```html
<Feature feature-key="firstFeature">
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']">
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature :feature-keys="['firstFeature', 'secondFeature']" requirement="all" :negate="true">
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

Lastly, you can use the *$toggly* service to check if a feature is ON or OFF programmatically, by simply injecting it in any component.

```js
export default {
  inject: ['$toggly'],
  ...
}
```

```js
await this.$toggly.isFeatureOn('firstFeature')
```

```js
await this.$toggly.isFeatureOff('secondFeature')
```

And even evaluate a feature gate (with requirement & negate support).

```js
await this.$toggly.evaluateFeatureGate('firstFeature', 'secondFeature'], 'any', true)
```

## Extensibility with Hooks

Toggly provides a powerful hooks system that allows you to extend SDK functionality by hooking into feature flag lifecycle events. This is perfect for integrating with analytics, monitoring tools, or implementing custom behaviors.

### What are Hooks?

Hooks let you execute custom code at specific points in the feature flag evaluation lifecycle:

- **beforeEvaluation**: Called before a feature flag is evaluated
- **afterEvaluation**: Called after a feature flag is evaluated (with the result)
- **beforeIdentify**: Called before user identity is set or cleared
- **afterIdentify**: Called after user identity is set or cleared
- **afterRefresh**: Called after feature definitions are refreshed from Toggly

### Creating a Hook

```typescript
import { Hook } from '@ops-ai/toggly-hooks-types';

const myAnalyticsHook: Hook = {
  getMetadata: () => ({
    name: 'MyAnalyticsHook',
    version: '1.0.0'
  }),
  
  afterEvaluation: async (data) => {
    // Send to analytics
    analytics.track('Feature Flag Evaluated', {
      feature: data.featureKey,
      enabled: data.result
    });
  }
};
```

### Registering Hooks

**During plugin initialization:**

```typescript
import { createToggly } from '@ops-ai/vue-feature-flags-toggly';

app.use(createToggly({
  appKey: 'your-app-key',
  environment: 'your-environment-name',
  hooks: [myAnalyticsHook]
}));
```

**At runtime:**

```vue
<script setup lang="ts">
import { useToggly } from '@ops-ai/vue-feature-flags-toggly';
import { onMounted, onUnmounted } from 'vue';

const toggly = useToggly();

onMounted(() => {
  toggly.addHook(myAnalyticsHook);
});

onUnmounted(() => {
  toggly.removeHook(myAnalyticsHook);
});
</script>
```

### Common Use Cases

**Analytics Integration:**
```typescript
const clarityHook: Hook = {
  getMetadata: () => ({ name: 'Microsoft Clarity', version: '1.0.0' }),
  afterEvaluation: async (data) => {
    if (typeof clarity !== 'undefined') {
      clarity('event', `FeatureFlag:${data.featureKey}`);
    }
  }
};
```

**Debug Logging:**
```typescript
const debugHook: Hook = {
  getMetadata: () => ({ name: 'DebugLogger', version: '1.0.0' }),
  afterEvaluation: async (data) => {
    if (import.meta.env.DEV) {
      console.debug('[Toggly]', data.featureKey, '=', data.result);
    }
  }
};
```

## Entity context

Pass `:context` and `context-kind` on `<Feature>` or call `$toggly.isFeatureOn(key, entity, kind)`. See [Vue entity context](https://docs.toggly.io/sdks/javascript/vue#entity-context).

```html
<Feature feature-key="NewProductBadge" :context="product" context-kind="Product">
  <span class="badge">New</span>
</Feature>
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
