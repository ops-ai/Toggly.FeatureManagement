Lightweight package that provides feature flags support for javascript applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply embed our latest bundle from the following CDN.

```html
<script src="https://cdn.jsdelivr.net/npm/@ops-ai/feature-flags-toggly@1.0.2/dist/feature-flags-toggly.bundle.js"></script>
```

Alternatively, you can use NPM to manually build the bundled *.js file.

```shell
$ npm install @ops-ai/feature-flags-toggly
$ cd node_modules/@ops-ai/feature-flags-toggly && npm run build
```

And then grab the generated bundled file from the ./dist directory.

## Basic Usage (with Toggly.io)

Initialize Toggly by running the Toggly.init method and by providing your App Key from your [Toggly application page](https://app.toggly.io)

```js
var featureFlagsDefaults = {
  "SignUpButton": true,
  "DemoScreenshot": true
};

Toggly.init({
  appKey: '<YOUR_APP_KEY>',
  environment: '<YOUR_APP_ENVIRONMENT>'
})
  .then(function () {
    // Now you can check if a feature (or more) is Enabled/Disabled
    
    if (Toggly.isFeatureOn('SignUpButton')) {
      // SignUpButton is ON
    }

    if (Toggly.isFeatureOff('DemoScreenshot')) {
      // DemoScreenshot is OFF
    }
});
```

You can also check multiple feature keys and make use of the *requirement* (FeatureRequirement.all, FeatureRequirement.any) and *negate* (bool) options.

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all)) {
  // ALL the provided feature keys are TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.any)) {
  // AT LEAST ONE the provided feature keys is TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all, true)) {
  // ALL the provided feature keys are FALSE
}
```

Lastly, you can set how often you would like to synchronize (re-fetch from Toggly) the feature flags values by setting the *.featureFlagsRefreshInterval when runnint *.init.

```js
Toggly.init({
  appKey: '<YOUR_APP_KEY>',
  environment: '<YOUR_APP_ENVIRONMENT>',
  featureFlagsRefreshInterval: 3 * 60 * 1000
})
  .then(function () {
    // Now you can check if a feature (or more) is Enabled/Disabled ...
  });
```

## Basic Usage (without Toggly.io)

Initialize Toggly by running the Toggly.init method

```js
var featureFlagsDefaults = {
  "SignUpButton": true,
  "DemoScreenshot": true
};

Toggly.init({ flagDefaults: featureFlagsDefaults }).then(function () {

  // Now you can check if a feature (or more) is Enabled/Disabled
  
  if (Toggly.isFeatureOn('SignUpButton')) {
    // SignUpButton is ON
  }

  if (Toggly.isFeatureOff('DemoScreenshot')) {
    // DemoScreenshot is OFF
  }
});
```

You can also check multiple feature keys and make use of the *requirement* (FeatureRequirement.all, FeatureRequirement.any) and *negate* (bool) options.

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all)) {
  // ALL the provided feature keys are TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.any)) {
  // AT LEAST ONE the provided feature keys is TRUE
}
```

```js
if (Toggly.evaluateFeatureGate(['ExampleFeatureKey1', 'ExampleFeatureKey2'], FeatureRequirement.all, true)) {
  // ALL the provided feature keys are FALSE
}
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

A hook is an object that implements the `Hook` interface from `@ops-ai/toggly-hooks-types`:

```js
const myAnalyticsHook = {
  getMetadata: () => ({
    name: 'MyAnalyticsHook',
    version: '1.0.0'
  }),
  
  beforeEvaluation: async (data) => {
    console.log('About to evaluate:', data.featureKey);
  },
  
  afterEvaluation: async (data) => {
    console.log('Evaluated:', data.featureKey, '=', data.result);
    // Send to analytics
    analytics.track('Feature Flag Evaluated', {
      feature: data.featureKey,
      enabled: data.result
    });
  },
  
  beforeIdentify: async (data) => {
    console.log('Setting identity:', data.userId);
  },
  
  afterIdentify: async (data) => {
    console.log('Identity set:', data.userId);
  },
  
  afterRefresh: async () => {
    console.log('Feature definitions refreshed');
  }
};
```

### Registering Hooks

You can register hooks in two ways:

**1. During initialization:**

```js
Toggly.init({
  appKey: '<YOUR_APP_KEY>',
  environment: '<YOUR_APP_ENVIRONMENT>',
  hooks: [myAnalyticsHook, myMonitoringHook]
})
  .then(function () {
    // Hooks are now active
  });
```

**2. At runtime:**

```js
// Add a hook
Toggly.addHook(myAnalyticsHook);

// Remove a hook
Toggly.removeHook(myAnalyticsHook);
```

### Hook Execution Order

When multiple hooks are registered:
- **before hooks** execute in FIFO order (first registered, first executed)
- **after hooks** execute in LIFO order (last registered, first executed)

This creates a "wrap" pattern where the first hook to start is the last to finish.

### Error Isolation

Hooks are designed to be safe:
- If a hook throws an error, it won't affect feature flag evaluation
- Other hooks will continue to execute
- Errors are logged but don't propagate to your application code

### Performance

Hooks are optimized for minimal performance impact:
- Hooks execute asynchronously without blocking evaluation
- Hook execution is extremely fast (typically < 1ms per hook)
- Multiple hooks can be registered without significant overhead

### Common Use Cases

**Analytics Integration:**
```js
const clarityHook = {
  getMetadata: () => ({ name: 'Microsoft Clarity', version: '1.0.0' }),
  afterEvaluation: async (data) => {
    if (typeof clarity !== 'undefined') {
      clarity('event', `FeatureFlag:${data.featureKey}`);
    }
  }
};
```

**Debug Logging:**
```js
const debugHook = {
  getMetadata: () => ({ name: 'DebugLogger', version: '1.0.0' }),
  beforeEvaluation: async (data) => {
    console.debug('[Toggly] Evaluating:', data);
  },
  afterEvaluation: async (data) => {
    console.debug('[Toggly] Result:', data.featureKey, '=', data.result);
  }
};
```

**Performance Monitoring:**
```js
const performanceHook = {
  getMetadata: () => ({ name: 'PerformanceMonitor', version: '1.0.0' }),
  beforeEvaluation: async (data) => {
    return { startTime: performance.now() };
  },
  afterEvaluation: async (data) => {
    const duration = performance.now() - data.context.startTime;
    if (duration > 10) {
      console.warn(`Slow evaluation: ${data.featureKey} took ${duration}ms`);
    }
  }
};
```

## Entity context

Target features by **page entity** (order, product, account) in addition to user rollouts. Pass the entity on each `isFeatureOn` / `evaluateFeatureGate` call — not on global user identity.

```js
Toggly.registerContext('Order', function (order) {
  return {
    kind: 'Order',
    key: String(order.id),
    attributes: { Status: order.status },
  };
});

if (Toggly.isFeatureOn('OrderBadge', order, 'Order')) {
  // enabled for this order
}
```

Evaluated-signed defs may be `boolean | EntityGate`. Use `isFeatureOn` (not `=== true`) so gate objects resolve offline. See [Entity & page context](https://docs.toggly.io/docs/core-concepts/entity-context).

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
