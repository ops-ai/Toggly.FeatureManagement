# @ops-ai/toggly-ga4-hook

Google Analytics 4 hook for Toggly Feature Flags SDK. Automatically pushes feature flag data to [Google Analytics 4](https://analytics.google.com/) for analytics and user behavior correlation.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is This?

This hook integrates Toggly feature flags with Google Analytics 4, allowing you to:
- **Track feature flag usage** as GA4 events
- **Correlate features with user behavior** in GA4 reports
- **Set user properties** for feature flag states
- **Analyze A/B test results** with GA4's built-in analysis tools
- **Build audiences** based on feature flag exposure
- **Monitor real-time feature changes** via GA4 events

## How It Works

The `GA4Hook` implements the Toggly SDK `Hook` interface and listens to multiple lifecycle events:

| Hook | GA4 Action |
|------|------------|
| `afterEvaluation` | Sends `feature_flag_evaluated` event |
| `afterIdentify` | Sets `user_id` via `gtag('config')` |
| `afterRefresh` | Sends `feature_flag_changed` event on state changes |

Example event sent to GA4:
```javascript
gtag('event', 'feature_flag_evaluated', {
  feature_key: 'checkout-v2',
  feature_enabled: true,
  event_category: 'toggly'
});
```

## Installation

```bash
npm install @ops-ai/toggly-ga4-hook
```

Or with yarn:
```bash
yarn add @ops-ai/toggly-ga4-hook
```

## Prerequisites

1. **Toggly SDK** - Any JavaScript-based Toggly SDK with hooks support (v1.0.0+)
2. **Google Analytics 4** - GA4 tracking code (`gtag.js`) must be loaded on your page

## Usage

### Vanilla JavaScript

```javascript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [
    new GA4Hook({
      measurementId: 'G-XXXXXXXXXX',
      trackEvaluations: true,
      trackChanges: true,
      setUserProperties: true,
      checkConsent: () => cookieConsent.analytics
    })
  ]
});
```

### React

```typescript
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

const TogglyProvider = await createTogglyProvider({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new GA4Hook({ measurementId: 'G-XXXXXXXXXX' })]
});
```

### Angular

```typescript
import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

bootstrapApplication(AppComponent, {
  providers: [
    provideToggly({
      appKey: 'your-app-key',
      environment: 'Production',
      hooks: [new GA4Hook({ measurementId: 'G-XXXXXXXXXX' })]
    })
  ]
});
```

### Vue

```typescript
import { createApp } from 'vue';
import { TogglyPlugin } from 'vue-feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

app.use(TogglyPlugin, {
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new GA4Hook({ measurementId: 'G-XXXXXXXXXX' })]
});
```

### Svelte

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new GA4Hook({ measurementId: 'G-XXXXXXXXXX' })]
});
```

### Astro

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new GA4Hook({ measurementId: 'G-XXXXXXXXXX' })]
});
```

## Configuration

```typescript
interface GA4HookOptions {
  // Enable or disable the hook (default: true)
  enabled?: boolean;

  // GA4 Measurement ID (e.g., 'G-XXXXXXXXXX')
  measurementId?: string;

  // Event name for evaluations (default: "feature_flag_evaluated")
  evaluationEventName?: string;

  // Event name for changes (default: "feature_flag_changed")
  changeEventName?: string;

  // Track feature evaluations (default: true)
  trackEvaluations?: boolean;

  // Track both true and false results (default: true)
  trackAllResults?: boolean;

  // Set user properties for features (default: false)
  setUserProperties?: boolean;

  // User property prefix (default: "ff_")
  userPropertyPrefix?: string;

  // Track real-time changes (default: true)
  trackChanges?: boolean;

  // Track user identity (default: true)
  trackIdentity?: boolean;

  // Custom parameters for all events
  customParameters?: Record<string, string | number | boolean>;

  // Consent callback (default: () => true)
  checkConsent?: () => boolean;

  // Debug mode (default: false)
  debug?: boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable or disable the hook entirely |
| `measurementId` | `string` | - | GA4 Measurement ID (optional, uses default gtag) |
| `evaluationEventName` | `string` | `"feature_flag_evaluated"` | Custom event name for evaluations |
| `changeEventName` | `string` | `"feature_flag_changed"` | Custom event name for changes |
| `trackEvaluations` | `boolean` | `true` | Track feature flag evaluations |
| `trackAllResults` | `boolean` | `true` | Track both true and false results |
| `setUserProperties` | `boolean` | `false` | Set GA4 user properties for features |
| `userPropertyPrefix` | `string` | `"ff_"` | Prefix for user property names |
| `trackChanges` | `boolean` | `true` | Track real-time feature changes |
| `trackIdentity` | `boolean` | `true` | Set user_id in GA4 |
| `customParameters` | `object` | `{}` | Custom parameters for all events |
| `checkConsent` | `function` | `() => true` | Consent check callback |
| `debug` | `boolean` | `false` | Enable debug logging |

### Full Configuration Example

```typescript
const ga4Hook = new GA4Hook({
  enabled: process.env.NODE_ENV === 'production',
  measurementId: 'G-XXXXXXXXXX',
  evaluationEventName: 'ff_evaluated',
  changeEventName: 'ff_changed',
  trackEvaluations: true,
  trackAllResults: true,
  setUserProperties: true,
  userPropertyPrefix: 'feature_',
  trackChanges: true,
  trackIdentity: true,
  customParameters: {
    app_version: '2.0.0',
    environment: 'production'
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
gtag('event', 'feature_flag_evaluated', {
  feature_key: 'new-checkout-flow',
  feature_enabled: true,
  event_category: 'toggly'
});
```

### Feature Changes (Real-time)

When a feature flag state changes:

```javascript
gtag('event', 'feature_flag_changed', {
  feature_key: 'dark-mode',
  old_value: false,
  new_value: true,
  event_category: 'toggly'
});
```

### User Properties

When `setUserProperties: true`:

```javascript
gtag('set', 'user_properties', {
  ff_dark_mode: 'on',
  ff_new_checkout: 'off'
});
```

### User Identity

When identity is set:

```javascript
gtag('config', 'G-XXXXXXXXXX', {
  user_id: 'user@example.com'
});
```

## Viewing Data in GA4

### Custom Events

1. Go to GA4 Admin → **Events**
2. Look for `feature_flag_evaluated` and `feature_flag_changed`
3. Events appear automatically after first trigger

### Event Parameters

In **Explore** → **Free Form**:
- Add `feature_key` as a dimension
- Add `feature_enabled` as a dimension
- Analyze feature flag usage patterns

### User Properties

1. Go to GA4 Admin → **Custom definitions** → **Custom user scopes**
2. Create custom dimensions for `ff_*` properties
3. Use in reports to segment by feature flag exposure

### Building Audiences

Create audiences based on feature exposure:

1. Go to GA4 Admin → **Audiences** → **New audience**
2. Add condition: Event = `feature_flag_evaluated`
3. Add parameter condition: `feature_key` equals `your-feature`
4. Add parameter condition: `feature_enabled` equals `true`

## Privacy & Consent

### GDPR/CCPA Compliance

The `checkConsent` callback allows integration with consent management platforms:

```typescript
// OneTrust example
new GA4Hook({
  checkConsent: () => window.OneTrust?.IsAlertBoxClosed() &&
                      window.OneTrust?.GetDomainData()?.Groups
                        ?.find(g => g.CustomGroupId === 'C0002')?.Status === 'active'
});

// Simple cookie consent example
new GA4Hook({
  checkConsent: () => document.cookie.includes('analytics_consent=true')
});

// Google Consent Mode v2
new GA4Hook({
  checkConsent: () => {
    // Check if analytics_storage consent is granted
    return window.dataLayer?.some(item =>
      item[0] === 'consent' &&
      item[1] === 'update' &&
      item[2]?.analytics_storage === 'granted'
    ) ?? false;
  }
});
```

### What data is sent

- Feature flag key name (e.g., `"dark-mode"`)
- Feature evaluation result (`true` / `false`)
- Custom parameters you explicitly configure
- User ID (only if `trackIdentity` is enabled and identity is set)
- No automatic PII collection

## Error Handling

The hook is designed to never break the Toggly SDK:

- All gtag API calls are wrapped in try-catch
- If gtag is not loaded, events are silently skipped
- If gtag throws an error, it is caught and logged to console
- The hook provides a console warning (not error) if gtag is not detected at initialization

## Performance

- **Overhead**: <0.1ms per evaluation
- **Bundle Size**: ~2KB (minified)
- **No batching**: Events are sent immediately via gtag's internal queue
- **Short-circuit**: Disabled hooks and filtered results exit immediately

## Dynamic Hook Management

You can add or remove the hook at runtime:

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';

// Add hook after initialization
Toggly.addHook(new GA4Hook({ measurementId: 'G-XXXXXXXXXX' }));

// Remove hook by name
Toggly.removeHook('ga4-hook');
```

## Troubleshooting

### Events not appearing in GA4

1. **Check gtag is loaded**: Ensure the GA4 tracking code is on the page before Toggly initializes
   ```javascript
   console.log('gtag available:', typeof window.gtag === 'function');
   ```

2. **Check measurement ID**: Verify your measurement ID is correct (format: `G-XXXXXXXXXX`)

3. **Check consent**: Verify your `checkConsent` callback returns `true`

4. **Check feature evaluation**: Ensure your feature flags are actually being evaluated

5. **Check the console**: Look for `[Toggly GA4 Hook]` messages

6. **Enable debug mode**:
   ```typescript
   new GA4Hook({ debug: true })
   ```

7. **Use GA4 DebugView**: Enable GA4 debug mode to see events in real-time
   ```javascript
   gtag('config', 'G-XXXXXXXXXX', { debug_mode: true });
   ```

### Console warning at startup

```
[Toggly GA4 Hook] Google Analytics 4 gtag not detected.
```

This means gtag was not loaded when the hook was created. The hook will automatically start sending events once gtag becomes available (e.g., loaded asynchronously).

### User properties not appearing

- User properties have a 24-character limit in GA4
- Special characters in flag keys are replaced with underscores
- Create custom dimensions in GA4 Admin for user properties

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
import { GA4Hook } from '@ops-ai/toggly-ga4-hook';
import type { GA4HookOptions } from '@ops-ai/toggly-ga4-hook';

const options: GA4HookOptions = {
  enabled: true,
  measurementId: 'G-XXXXXXXXXX',
  trackEvaluations: true,
  setUserProperties: true,
};

const hook = new GA4Hook(options);
```

## Requirements

- **Toggly SDK**: Any JS SDK v1.0.0+ with hooks support
- **Google Analytics 4**: gtag.js loaded on the page
- **Browser**: Modern browsers with ES2020+ support
- **Node.js**: 18+ (for development)

## Related Packages

- [@ops-ai/toggly-hooks-types](https://www.npmjs.com/package/@ops-ai/toggly-hooks-types) - Hook type definitions
- [@ops-ai/toggly-clarity-hook](https://www.npmjs.com/package/@ops-ai/toggly-clarity-hook) - Microsoft Clarity hook
- [@ops-ai/feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/feature-flags-toggly) - Core JavaScript SDK
- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/ngx-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/ngx-feature-flags-toggly) - Angular SDK

## Find Out More

- [Toggly Documentation](https://docs.toggly.io)
- [Google Analytics 4 Docs](https://developers.google.com/analytics/devguides/collection/ga4)
- [GA4 Events Reference](https://developers.google.com/analytics/devguides/collection/ga4/events)
- [Toggly Hooks Guide](https://docs.toggly.io/hooks)

## License

MIT
