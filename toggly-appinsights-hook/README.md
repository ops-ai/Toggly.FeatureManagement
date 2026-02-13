# @ops-ai/toggly-appinsights-hook

Azure Application Insights hook for Toggly Feature Flags SDK. Automatically sends feature flag telemetry to [Azure Application Insights](https://azure.microsoft.com/en-us/products/monitor) for monitoring, analytics, and diagnostics correlation.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is This?

This hook integrates Toggly feature flags with Azure Application Insights, allowing you to:
- **Track feature flag evaluations** as custom events
- **Add feature flags as custom properties** on all telemetry
- **Correlate features with application behavior** in Application Insights
- **Set authenticated user context** when identity changes
- **Monitor real-time feature changes** via custom events
- **Analyze A/B test results** using Application Insights analytics
- **Create alerts** based on feature flag state changes

## How It Works

The `AppInsightsHook` implements the Toggly SDK `Hook` interface and listens to multiple lifecycle events:

| Hook | Application Insights Action |
|------|------------|
| `afterEvaluation` | Sends `FeatureFlagEvaluated` custom event via `trackEvent()` |
| `afterIdentify` | Sets authenticated user via `setAuthenticatedUserContext()` |
| `afterRefresh` | Sends `FeatureFlagChanged` event on state changes + updates telemetry properties |

Example event sent to Application Insights:

```javascript
appInsights.trackEvent({
  name: 'FeatureFlagEvaluated',
  properties: {
    feature_key: 'checkout-v2',
    feature_enabled: 'true',
    category: 'toggly'
  }
});
```

## Installation

```bash
npm install @ops-ai/toggly-appinsights-hook
```

Or with yarn:
```bash
yarn add @ops-ai/toggly-appinsights-hook
```

## Prerequisites

1. **Toggly SDK** - Any JavaScript-based Toggly SDK with hooks support (v1.0.0+)
2. **Application Insights JavaScript SDK** - Must be loaded on your page (`window.appInsights`)

### Setting up Application Insights

```html
<!-- Add the Application Insights JavaScript SDK -->
<script type="text/javascript">
!(function (cfg){function e(){cfg.onInit&&cfg.onInit(i)}var S,u,D,t,n,i,C=window,x=document,w=C.location,I="script",b="ingestionendpoint",E="disableExceptionTracking",A="ai.device.";"instrumentationKey"[S="connectionString"];(D=cfg[S]||"")&&(D.indexOf("InstrumentationKey=")!==-1?u="IngestionEndpoint=https://dc.services.visualstudio.com/v2/track":u.indexOf("IngestionEndpoint=")!==-1||(u+=";IngestionEndpoint=https://dc.services.visualstudio.com/v2/track"));var l=D?D.replace("InstrumentationKey=",""):cfg.instrumentationKey||"",G=cfg.sdk||"javascript:snippet";G+=","+l;var v=["src","name","ld","useXhr","crossOrigin","onInit","cfg"];(function(cfg){for(var i=0;i<v.length;i++){var x=cfg[v[i]];x&&(D+=(D?";":"")+v[i]+"="+encodeURIComponent(x))}})(cfg);var c=C[t="appInsights"];c&&c.queue||(C[t]=i={config:cfg,initialize:!0,queue:[],sv:"8",version:2,snippet:G},cfg[E]||i.queue.push(["trackPageView",{}]),e())})(
{connectionString:"YOUR_CONNECTION_STRING"}
);
</script>
<script type="text/javascript" src="https://js.monitor.azure.com/scripts/b/ai.3.gbl.min.js" crossorigin="anonymous"></script>
```

## Usage

### Vanilla JavaScript

```javascript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [
    new AppInsightsHook({
      trackEvaluations: true,
      trackChanges: true,
      setCustomProperties: true,
      checkConsent: () => cookieConsent.analytics
    })
  ]
});
```

### React

```typescript
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

const TogglyProvider = await createTogglyProvider({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new AppInsightsHook({ setCustomProperties: true })]
});
```

### Angular

```typescript
import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

bootstrapApplication(AppComponent, {
  providers: [
    provideToggly({
      appKey: 'your-app-key',
      environment: 'Production',
      hooks: [new AppInsightsHook({ setCustomProperties: true })]
    })
  ]
});
```

### Vue

```typescript
import { createApp } from 'vue';
import { TogglyPlugin } from 'vue-feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

app.use(TogglyPlugin, {
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new AppInsightsHook({ setCustomProperties: true })]
});
```

### Svelte

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new AppInsightsHook({ setCustomProperties: true })]
});
```

### Astro

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new AppInsightsHook({ setCustomProperties: true })]
});
```

## Configuration

```typescript
interface AppInsightsHookOptions {
  // Enable or disable the hook (default: true)
  enabled?: boolean;

  // Application Insights instrumentation key (optional, uses window.appInsights)
  instrumentationKey?: string;

  // Event name for evaluations (default: "FeatureFlagEvaluated")
  evaluationEventName?: string;

  // Event name for changes (default: "FeatureFlagChanged")
  changeEventName?: string;

  // Track feature evaluations (default: true)
  trackEvaluations?: boolean;

  // Track both true and false results (default: true)
  trackAllResults?: boolean;

  // Set custom properties on all telemetry (default: true)
  setCustomProperties?: boolean;

  // Property name prefix (default: "ff_")
  propertyPrefix?: string;

  // Track real-time changes (default: true)
  trackChanges?: boolean;

  // Track user identity (default: true)
  trackIdentity?: boolean;

  // Custom properties for all events
  customProperties?: Record<string, string | number | boolean>;

  // Custom measurements for all events
  customMeasurements?: Record<string, number>;

  // Consent callback (default: () => true)
  checkConsent?: () => boolean;

  // Debug mode (default: false)
  debug?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable or disable the hook entirely |
| `instrumentationKey` | `string` | - | Instrumentation key (optional, uses global appInsights) |
| `evaluationEventName` | `string` | `"FeatureFlagEvaluated"` | Custom event name for evaluations |
| `changeEventName` | `string` | `"FeatureFlagChanged"` | Custom event name for changes |
| `trackEvaluations` | `boolean` | `true` | Track feature flag evaluations |
| `trackAllResults` | `boolean` | `true` | Track both true and false results |
| `setCustomProperties` | `boolean` | `true` | Add feature flags as custom properties on all telemetry |
| `propertyPrefix` | `string` | `"ff_"` | Prefix for property names |
| `trackChanges` | `boolean` | `true` | Track real-time feature changes |
| `trackIdentity` | `boolean` | `true` | Set authenticated user context |
| `customProperties` | `object` | `{}` | Custom properties for all events |
| `customMeasurements` | `object` | `{}` | Custom measurements for all events |
| `checkConsent` | `function` | `() => true` | Consent check callback |
| `debug` | `boolean` | `false` | Enable debug logging |

### Full Configuration Example

```typescript
const appInsightsHook = new AppInsightsHook({
  enabled: process.env.NODE_ENV === 'production',
  evaluationEventName: 'FF_Evaluated',
  changeEventName: 'FF_Changed',
  trackEvaluations: true,
  trackAllResults: true,
  setCustomProperties: true,
  propertyPrefix: 'feature_',
  trackChanges: true,
  trackIdentity: true,
  customProperties: {
    app_version: '2.0.0',
    environment: 'production'
  },
  customMeasurements: {
    session_duration: 120
  },
  checkConsent: () => {
    return window.cookieConsent?.analytics ?? false;
  },
  debug: false
});
```

## What Gets Tracked

### Feature Evaluations

When a feature flag is evaluated:

```javascript
appInsights.trackEvent({
  name: 'FeatureFlagEvaluated',
  properties: {
    feature_key: 'new-checkout-flow',
    feature_enabled: 'true',
    category: 'toggly'
  }
});
```

### Feature Changes (Real-time)

When a feature flag state changes:

```javascript
appInsights.trackEvent({
  name: 'FeatureFlagChanged',
  properties: {
    feature_key: 'dark-mode',
    old_value: 'false',
    new_value: 'true',
    category: 'toggly'
  }
});
```

### Custom Properties on All Telemetry

When `setCustomProperties: true`, feature flags are added as custom properties to **all** telemetry:

```javascript
// All telemetry (page views, exceptions, requests, etc.) will include:
{
  ff_dark_mode: 'enabled',
  ff_new_checkout: 'disabled'
}
```

This is achieved via Application Insights' `addTelemetryInitializer` API.

### User Identity

When identity is set:

```javascript
appInsights.setAuthenticatedUserContext('user@example.com');
```

## Viewing Data in Azure Portal

### Custom Events

1. Go to Azure Portal → Application Insights resource
2. Navigate to **Logs** (Analytics)
3. Query custom events:

```kusto
customEvents
| where name == "FeatureFlagEvaluated"
| extend feature_key = tostring(customDimensions.feature_key)
| extend feature_enabled = tostring(customDimensions.feature_enabled)
| summarize count() by feature_key, feature_enabled
| order by count_ desc
```

### Feature Flag Correlation

Correlate feature flags with other telemetry:

```kusto
// Find exceptions by feature flag
exceptions
| extend dark_mode = tostring(customDimensions.ff_dark_mode)
| summarize count() by dark_mode, type
```

```kusto
// Performance by feature flag
requests
| extend checkout_v2 = tostring(customDimensions.ff_checkout_v2)
| summarize avg(duration), percentile(duration, 95) by checkout_v2
```

### Creating Alerts

Create alerts when feature flags change:

1. Go to **Alerts** → **Create alert rule**
2. Select **Custom log search**
3. Query:
   ```kusto
   customEvents
   | where name == "FeatureFlagChanged"
   | where customDimensions.feature_key == "critical-feature"
   ```

## Privacy & Consent

### GDPR/CCPA Compliance

The `checkConsent` callback allows integration with consent management platforms:

```typescript
// OneTrust example
new AppInsightsHook({
  checkConsent: () => window.OneTrust?.IsAlertBoxClosed() &&
                      window.OneTrust?.GetDomainData()?.Groups
                        ?.find(g => g.CustomGroupId === 'C0002')?.Status === 'active'
});

// Simple cookie consent example
new AppInsightsHook({
  checkConsent: () => document.cookie.includes('analytics_consent=true')
});
```

### What data is sent

- Feature flag key name (e.g., `"dark-mode"`)
- Feature evaluation result (`true` / `false`)
- Custom properties you explicitly configure
- User ID (only if `trackIdentity` is enabled and identity is set)
- No automatic PII collection

## Error Handling

The hook is designed to never break the Toggly SDK:

- All Application Insights API calls are wrapped in try-catch
- If appInsights is not loaded, events are silently skipped
- If appInsights throws an error, it is caught and logged to console
- The hook provides a console warning (not error) if appInsights is not detected at initialization

## Performance

- **Overhead**: <0.1ms per evaluation
- **Bundle Size**: ~2KB (minified)
- **No batching**: Events use Application Insights' internal batching
- **Short-circuit**: Disabled hooks and filtered results exit immediately
- **Telemetry Initializer**: Registered once, runs efficiently on each telemetry item

## Dynamic Hook Management

You can add or remove the hook at runtime:

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';

// Add hook after initialization
Toggly.addHook(new AppInsightsHook({ setCustomProperties: true }));

// Remove hook by name
Toggly.removeHook('appinsights-hook');
```

## Troubleshooting

### Events not appearing in Application Insights

1. **Check appInsights is loaded**: Ensure the Application Insights SDK is on the page before Toggly initializes
   ```javascript
   console.log('appInsights available:', typeof window.appInsights !== 'undefined');
   ```

2. **Check connection string**: Verify your Application Insights connection string is correct

3. **Check consent**: Verify your `checkConsent` callback returns `true`

4. **Check feature evaluation**: Ensure your feature flags are actually being evaluated

5. **Check the console**: Look for `[Toggly AppInsights Hook]` messages

6. **Enable debug mode**:
   ```typescript
   new AppInsightsHook({ debug: true })
   ```

7. **Check Azure Portal delay**: Application Insights data may take a few minutes to appear

### Console warning at startup

```
[Toggly AppInsights Hook] Application Insights SDK not detected.
```

This means appInsights was not loaded when the hook was created. The hook will automatically start sending events once appInsights becomes available.

### Custom properties not appearing

- Property names are sanitized: special characters replaced with underscores
- Property names are truncated to 150 characters (Application Insights limit)
- Ensure `setCustomProperties` is set to `true`

## Development

### Running Tests

```bash
npm test
```

### Running Tests with Coverage

```bash
npm test -- --coverage
```

### Building

```bash
npm run build
```

### Type Checking

```bash
npm run typecheck
```

## TypeScript Support

Full TypeScript support included:

```typescript
import { AppInsightsHook } from '@ops-ai/toggly-appinsights-hook';
import type { AppInsightsHookOptions } from '@ops-ai/toggly-appinsights-hook';

const options: AppInsightsHookOptions = {
  enabled: true,
  trackEvaluations: true,
  setCustomProperties: true,
};

const hook = new AppInsightsHook(options);
```

## Requirements

- **Toggly SDK**: Any JS SDK v1.0.0+ with hooks support
- **Application Insights**: JavaScript SDK loaded on the page
- **Browser**: Modern browsers with ES2020+ support
- **Node.js**: 18+ (for development)

## Related Packages

- [@ops-ai/toggly-hooks-types](https://www.npmjs.com/package/@ops-ai/toggly-hooks-types) - Hook type definitions
- [@ops-ai/toggly-ga4-hook](https://www.npmjs.com/package/@ops-ai/toggly-ga4-hook) - Google Analytics 4 hook
- [@ops-ai/toggly-clarity-hook](https://www.npmjs.com/package/@ops-ai/toggly-clarity-hook) - Microsoft Clarity hook
- [@ops-ai/feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/feature-flags-toggly) - Core JavaScript SDK
- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/ngx-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/ngx-feature-flags-toggly) - Angular SDK

## Find Out More

- [Toggly Documentation](https://docs.toggly.io)
- [Application Insights JavaScript SDK](https://learn.microsoft.com/en-us/azure/azure-monitor/app/javascript)
- [Application Insights Documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/app-insights-overview)
- [Toggly Hooks Guide](https://docs.toggly.io/hooks)

## License

MIT
