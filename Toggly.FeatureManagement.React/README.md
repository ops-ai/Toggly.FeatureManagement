Lightweight package that provides feature flags support for React applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/react-feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Compatibility

Requires matching React and React DOM versions: React 18.2+ or React 19.x.
The SDK uses your application's React and JSX runtimes as peer dependencies.
React 18 applications can retain their existing React 18 setup.
Packed consumer tests cover 18.2.0, 18.3.1, and 19.3.0, including provider,
hooks, feature gates, context changes, refresh, and cleanup in a browser.

## Installation

Simply install use NPM to install this package.

```shell
$ npm i -s @ops-ai/react-feature-flags-toggly
```

## Basic Usage (with Toggly.io)

Import **createTogglyProvider** in your index file.

```js
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly'
```

Create a TogglyProvider with your App Key & Environment name from your [Toggly application page](https://app.toggly.io).

```js
 const TogglyProvider = await createTogglyProvider({
    appKey: 'your-app-key', // You can find this in Toggly.io
    environment: 'your-environment-name', // You can find this in Toggly.io
  })
```

Wrap your App component with the newly created TogglyProvider.

```js
  const root = createRoot(
    document.getElementById('root') as HTMLElement,
  )
  root.render(
    <StrictMode>
      <TogglyProvider>
        <App />
      </TogglyProvider>
    </StrictMode>,
  )
```

Using this package with [Toggly](https://toggly.io) allows you to define custom feature rollouts.

Custom rollouts offers the ability to show features only to certain groups of users based on various custom rules which you can define in [Toggly](https://app.toggly.io).

In case you want to support custom feature rollouts, remember to provide an unique identity string for each user to make sure they get the same feature values on future visits.

```js
  const TogglyProvider = await createTogglyProvider({
    appKey: 'your-app-key', // You can find this in Toggly.io
    environment: 'your-environment-name', // You can find this in Toggly.io
    identity: 'unique-user-identifier', // Use this in case you want to support custom feature rollouts
  })
```

Now you can start using the Feature component anywhere in your application by importing the Feature component.

```js
import { Feature } from '@ops-ai/react-feature-flags-toggly'
```

```html
<Feature featureKey={'firstFeature'}>
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}>
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']} requirement={'any'}>
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}  negate={false}>
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

## Basic Usage (without Toggly.io)

Import **createTogglyProvider** in your index file.

```js
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly'
```

Create a TogglyProvider and provide your feature defaults.

```js
  const featureDefaults = {
    mainDescription: true,
    documentationItem: true,
    toolingItem: true,
  }

 const TogglyProvider = await createTogglyProvider({
    featureDefaults: featureDefaults
  })
```

Wrap your App component with the newly created TogglyProvider.

```js
  const root = createRoot(
    document.getElementById('root') as HTMLElement,
  )
  root.render(
    <StrictMode>
      <TogglyProvider>
        <App />
      </TogglyProvider>
    </StrictMode>,
  )
```

Now you can start using the Feature component anywhere in your application by importing the Feature component.

```js
import { Feature } from '@ops-ai/react-feature-flags-toggly'
```

```html
<Feature featureKey={'firstFeature'}>
  <p>This feature can be turned on or off.</p>
</Feature>
```

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}>
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']} requirement={'any'}>
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

```html
<Feature featureKeys={['firstFeature', 'secondFeature']}  negate={false}>
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

## Device-local post-filter gates

Gate bundles of flags behind device-local master switches (Settings toggles, `localStorage`, in-app beta gates) while rollouts stay on the worker. See the full guide: **[Post-filter gates](https://docs.toggly.io/sdks/client-side/post-filter)**.

```tsx
import toggly from '@ops-ai/react-feature-flags-toggly';

let apiRedesignEnabled = false;

toggly.init({
  appKey: 'your-app-key',
  localGates: [{
    id: 'apiRedesign',
    flagKeys: ['ApiV2Checkout', 'ApiV2Profile'],
    isEnabled: () => apiRedesignEnabled,
  }],
});

// OFF — instant, no network
apiRedesignEnabled = false;
toggly.notifyLocalGatesChanged();

// ON — refresh remote rollouts, then notify UI
apiRedesignEnabled = true;
await toggly._loadFeatures();
toggly.notifyLocalGatesChanged();
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
      enabled: data.result,
      userId: data.userId
    });
  },
  
  afterIdentify: async (data) => {
    // Update analytics user context
    analytics.identify(data.userId, data.context);
  }
};
```

### Registering Hooks

You can register hooks in two ways:

**1. During initialization:**

```typescript
const TogglyProvider = await createTogglyProvider({
  appKey: 'your-app-key',
  environment: 'your-environment-name',
  hooks: [myAnalyticsHook, myMonitoringHook]
});
```

**2. At runtime using the service:**

```typescript
import { useToggly } from '@ops-ai/react-feature-flags-toggly';

function MyComponent() {
  const { togglyService } = useToggly();
  
  useEffect(() => {
    // Add a hook
    togglyService.addHook(myAnalyticsHook);
    
    // Cleanup: remove hook on unmount
    return () => {
      togglyService.removeHook(myAnalyticsHook);
    };
  }, [togglyService]);
  
  return <div>...</div>;
}
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

**Debug Logging (Development Only):**
```typescript
const debugHook: Hook = {
  getMetadata: () => ({ name: 'DebugLogger', version: '1.0.0' }),
  afterEvaluation: async (data) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Toggly]', data.featureKey, '=', data.result);
    }
  }
};
```

**React Component Hook Integration:**
```typescript
function useFeatureFlagAnalytics() {
  const { togglyService } = useToggly();
  
  useEffect(() => {
    const analyticsHook: Hook = {
      getMetadata: () => ({ name: 'Analytics', version: '1.0.0' }),
      afterEvaluation: async (data) => {
        // Your analytics logic
        trackEvent('feature_evaluated', {
          feature: data.featureKey,
          result: data.result
        });
      }
    };
    
    togglyService.addHook(analyticsHook);
    
    return () => togglyService.removeHook(analyticsHook);
  }, [togglyService]);
}
```

## Entity context

Pass a domain object per `<Feature>` or `isFeatureOn` call (list rows, detail pages). Register mappers with `Toggly.registerContext` — see [React entity context](https://docs.toggly.io/sdks/javascript/react#entity-context).

```jsx
<Feature featureKey="OrderBadge" context={order} contextKind="Order">
  <Badge />
</Feature>
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
## Minted identity and context changes

Supply `instanceId` from your trusted backend in provider options or
`service.setContext({ instanceId })`. The browser SDK never mints tokens or uses
Backend keys. Definitions with `i` omit client `u`, `userId`, `g` and `claim.*`;
without a token, existing identity/group/claim targeting remains supported.

`setContext` accepts partial updates. Omitted fields retain their values, except
an explicit identity update clears an omitted token. Pass `instanceId: ''` to
return to the current client identity; `identity: ''` clears identity and token.
A failed refresh still rejects its Promise, but keeps the new context's scoped
cache or defaults, never the previous user's flags or token. Definitions,
revisions and pending responses are isolated by context. Queued telemetry and
retries retain their original attribution while all contexts share one bounded
queue. Hooks ignore superseded results after context or owner replacement.

Client-generated `u` acceptance is controlled by the server application's setting,
which is **off by default**. HTTP 202 does not prove that identity was accepted.

## Browser telemetry

Telemetry is enabled by default for browser clients with an application key.
Each `Toggly` service owns one bounded in-memory reporter, started on the first
recorded event. Hooks and components share that reporter. Set
`enableTelemetry: false` in the service or `createTogglyProvider` configuration
to opt out. Server rendering and keyless clients start no frontend telemetry.

```typescript
const toggly = new Toggly({
  appKey: 'your-app-key',
  environment: 'Production',
  enableTelemetry: true,
  metricsBaseUrl: 'https://metrics.toggly.io',
  telemetryFlushIntervalMs: 45000,
})

toggly.recordUsage('checkout')
toggly.recordView('checkout', 'control')
toggly.incrementCounter('orders', 1)
toggly.setGauge('cart-value', 29.95)
await toggly.flushTelemetry()
// For a directly owned service, call this when its lifetime ends:
toggly.dispose()
```

The same methods are available on the service from `useContext(context)`.
Automatic checks count each evaluated feature after entity and local gates,
before aggregate negation, preserving gate short circuiting. Enabled assigned
variants retain their name; other outcomes use `enabled` or `disabled`.
Variant value lookups count once. Recomputed UI evaluations count again,
including evaluations repeated by development StrictMode. Rendering never
records a view or usage event. Internal refresh and cache projection are silent;
usage and views are explicit and do not evaluate features.

`createTogglyProvider` retains its shared service while any instance of that
returned provider is mounted. StrictMode effect replay retains the same owner;
final unmount disposes it in a microtask, and later remount creates a fresh owner.
Separate provider factories own separate services. Raw context providers leave
service disposal to the application. Disposal remains synchronous, detaches
lifecycle listeners, closes live updates and initiates one best-effort final flush.
Pending definitions requests cannot restart live updates after disposal.

Telemetry includes application key, environment, aggregate feature counts and
application metrics, plus optional host-provided `instanceId` as `i`, or the
current client `identity` as `u`. A nonblank `i` takes precedence. It excludes
groups, claims and entity context and
is never persisted. The metrics endpoint is independent from definitions requests
and carries no authentication or cookies. The SDK appends `/api/frontend/telemetry`
to an HTTP(S) base path without credentials, query or fragment. Invalid endpoints
disable telemetry; invalid intervals fall back to 45 seconds. Supported intervals
are 30–60 seconds with scheduling jitter.

Delivery uses bounded batches, a five-second timeout and at most two retries for
HTTP 429/503. Page hiding and teardown trigger best-effort flushes; delivery is
not guaranteed and never controls feature availability. Counter deltas must be
nonnegative integers, gauges finite nonnegative numbers, and each supplied value
at most 1,000,000. Variant names accept 1–64 ASCII letters, digits, underscores and
hyphens. Do not reuse a buffered metric name for both counters and gauges.
