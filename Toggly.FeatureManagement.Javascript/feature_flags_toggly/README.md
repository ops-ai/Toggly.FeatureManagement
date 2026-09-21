Lightweight package that provides feature flags support for javascript applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Initialize with a known user

Requires **1.8.0 or later** (the new API is not available in earlier published versions).

```javascript
// Run after your application knows the signed-in user, before checking flags.
await Toggly.init({
  appKey: 'your-public-app-key',
  environment: 'Production',
  identity: 'user-123',           // Stable user identifier, not a display name.
  groups: ['beta', 'team-a'],     // Memberships used by targeting rules.
  claims: { plan: 'pro' },       // String attributes used by targeting rules.
});

// The first definitions request already contains this targeting context.
const showNewDashboard = Toggly.isFeatureOn('NewDashboard');
```

Passing context during initialization avoids an intermediate request followed
by a refreshing `setContext` call. Omitted fields reuse persisted context;
omitting identity also generates an identifier when none exists. Explicit
`identity: ''`, `groups: []`, and `claims: {}` clear their respective fields.
Supplied collections are copied. Context remains usable in memory when
localStorage is unavailable. Use `setContext` for later user/context changes.

## Frontend telemetry

Requires **1.9.0 or later**.

With an application key, the SDK records a count for each feature actually
checked and sends batched counts to `https://metrics.toggly.io`. Local and
entity gates affect the recorded enabled or disabled result. Assigned variants
are recorded by name. Feature refreshes and cache reads do not count as checks.

```javascript
await Toggly.init({
  appKey: 'your-public-app-key',
  environment: 'Production',
  // Optional: enableTelemetry: false,
  // Optional: metricsBaseUrl: 'https://your-metrics-host.example',
  // Optional: telemetryFlushIntervalMs: 45000, // 30000 to 60000
});

Toggly.isFeatureOn('NewDashboard');
Toggly.recordUsage('NewDashboard');
Toggly.recordView('NewDashboard', 'Treatment');
Toggly.incrementCounter('checkout_started');
Toggly.setGauge('cart_size', 3);
await Toggly.flushTelemetry();
```

The explicit methods do not check a feature. `recordUsage` and `recordView`
default to the `enabled` variant. Telemetry contains application key,
environment, feature/variant counts, and metric values. It also carries a
host-supplied minted `instanceId` as `i`, or the current client identity as `u`
when no minted token is configured. Groups, claims and entity context are omitted. Omit the application key or
set `enableTelemetry: false` to keep telemetry inactive. Browser page exit
initiates a best-effort flush.

## Host-minted identities

Requires **1.9.0 or later**. Obtain the capability from your own trusted backend;
never put a Backend application key in the browser.

```javascript
await Toggly.init({
  appKey: 'your-public-app-key',
  identity: 'user-123',
  instanceId: tokenFromYourBackend,
});
```

The definitions request sends `i` and suppresses client identity, groups and
claims while that token is configured. Both regular and variant definitions
retain their existing targeting parameters without a token. Tokens are held
in memory; definitions and revisions are cached separately by token and
client context. Reinitialization does not reuse an omitted token.

`Toggly.instanceId = replacementToken` changes the token synchronously; call
`await Toggly.refresh()` to fetch its definitions. Setting it to `''` deliberately
falls back to the current client identity. `clearIdentity()` clears both the
identity and token; `clearContext()` also clears groups and claims and refreshes.
Changing targeting context immediately clears the prior in-memory snapshot and
invalidates pending responses. Synchronous identity setters retain their
existing no-automatic-fetch behavior; `setContext` refreshes after its changes.

Telemetry attribution acceptance is server-controlled. The
`AcceptClientGeneratedIdentitiesForMetrics` application setting is **off by
default** and must be enabled to accept client `u`. An unknown, expired or rotated `i` can be
accepted anonymously; HTTP 202 does not prove attribution or metric persistence.

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply embed our latest bundle from the following CDN.

```html
<script src="https://cdn.jsdelivr.net/npm/@ops-ai/feature-flags-toggly@1.9.0/dist/feature-flags-toggly.bundle.js"></script>
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

### Cleanup and browser verification

`Toggly.cancelRefreshInterval()` synchronously stops the current reporter,
WebSocket and background refresh work, aborts owned definitions requests, and
starts one best-effort final telemetry flush. Identity, token and compatible
application/environment changes preserve one reporter: accepted events keep
their original attribution, and new events immediately use the new context.
All contexts share the same 2,000-entry / 256 KiB pending and in-flight budget.
Evaluations capture their context and variant before user callbacks; a callback
changing identity cannot relabel that evaluation's check.

Reinitialization with different metrics endpoint, interval, error callback or
opt-out settings discards the old telemetry queue and aborts its transport before
creating another owner. This also cancels an earlier cleanup's final request;
an abort cannot establish whether the server already received it. Reinitializing
without an app key pauses new telemetry while preserving accepted old data for
flush. Reactivation reattaches browser lifecycle listeners. Late definitions
responses and hook/WebSocket continuations cannot restore a replaced context. Use
`await Toggly.flushTelemetry()` before cleanup when explicit completion is
needed. Restarting only the definitions interval preserves the current reporter.

Maintainers can run `npm run test:browser-host` to build and pack the SDK, install
an isolated consumer, and exercise its actual browser bundle against a local
collector. This also checks TypeScript4.9 declarations, import-only Node silence,
CORS/gzip, effective counts and lifecycle isolation. The default install resolves
public npm dependencies; `TOGGLY_CLIENT_TELEMETRY_TARBALL` is an optional explicit
local artifact override for intermediate verification.
