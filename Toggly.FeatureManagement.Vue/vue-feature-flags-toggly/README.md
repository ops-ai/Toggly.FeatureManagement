Lightweight package that provides feature flags support for Vue.js applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply install use NPM to install this package.

```shell
$ npm i -s @ops-ai/vue-feature-flags-toggly
```

## Basic Usage (with Toggly.io)

Import the Toggly plugin in your main file.

```js
import { toggly } from "@ops-ai/vue-feature-flags-toggly";
```

Install the toggly plugin while providing your App Key & Environment name from your [Toggly application page](https://app.toggly.io). This will register the Feature component & $toggly service globally.

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

// OFF — instant
apiRedesignEnabled = false;
toggly.notifyLocalGatesChanged();

// ON — reload remote flags, then notify UI
apiRedesignEnabled = true;
await toggly._loadFeatures();
toggly.notifyLocalGatesChanged();
```

## Basic Usage (without Toggly.io)

Import the Toggly plugin in your main file.

```js
import { toggly } from "@ops-ai/vue-feature-flags-toggly";
```

Install the toggly plugin while providing your default feature flags. This will register the Feature component & $toggly service globally.

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

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).