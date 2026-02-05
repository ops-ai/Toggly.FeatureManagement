# @ops-ai/toggly-clarity-hook

Microsoft Clarity hook for Toggly Feature Flags SDK. Automatically pushes feature flag data to [Microsoft Clarity](https://clarity.microsoft.com/) session recordings and heatmaps when feature flags are evaluated.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is This?

This hook integrates Toggly feature flags with Microsoft Clarity, allowing you to:
- **Correlate feature flags with user behavior** captured in Clarity sessions
- **Filter session recordings** by which features were active
- **Debug issues** by seeing which features were enabled during a session
- **Analyze A/B tests** with session replay data
- **Track feature adoption** through Clarity custom events

## How It Works

The `ClarityHook` implements the Toggly SDK `Hook` interface and listens to the `afterEvaluation` lifecycle event. When a feature flag evaluates to `true`, it sends a custom event to Clarity:

```
clarity("event", "FeatureFlag:{flagKey}")
```

Events are sent:
- **Immediately** (no batching - Clarity handles its own queuing)
- **Only when result is `true`** (disabled features are not tracked)
- **On every evaluation** when the feature is enabled

## Installation

```bash
npm install @ops-ai/toggly-clarity-hook
```

Or with yarn:
```bash
yarn add @ops-ai/toggly-clarity-hook
```

## Prerequisites

1. **Toggly SDK** - Any JavaScript-based Toggly SDK with hooks support (v1.0.0+)
2. **Microsoft Clarity** - Clarity tracking code must be loaded on your page

## Usage

### Vanilla JavaScript

```javascript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [
    new ClarityHook({
      enabled: true,
      eventPrefix: 'FF:',
      checkConsent: () => cookieConsent.analytics
    })
  ]
});
```

### React

```typescript
import { createTogglyProvider } from '@ops-ai/react-feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

const TogglyProvider = await createTogglyProvider({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new ClarityHook()]
});
```

### Angular

```typescript
import { provideToggly } from '@ops-ai/ngx-feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

bootstrapApplication(AppComponent, {
  providers: [
    provideToggly({
      appKey: 'your-app-key',
      environment: 'Production',
      hooks: [new ClarityHook()]
    })
  ]
});
```

### Vue

```typescript
import { createApp } from 'vue';
import { TogglyPlugin } from 'vue-feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

app.use(TogglyPlugin, {
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new ClarityHook()]
});
```

### Svelte

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new ClarityHook()]
});
```

### Astro

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new ClarityHook()]
});
```

### Gatsby

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

Toggly.init({
  appKey: 'your-app-key',
  environment: 'Production',
  hooks: [new ClarityHook()]
});
```

## Configuration

```typescript
interface ClarityHookOptions {
  // Enable or disable the hook (default: true)
  enabled?: boolean;

  // Prefix for Clarity event names (default: "FeatureFlag:")
  eventPrefix?: string;

  // Consent callback, called before each event (default: () => true)
  checkConsent?: () => boolean;
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable or disable the hook entirely |
| `eventPrefix` | `string` | `"FeatureFlag:"` | Prefix for Clarity custom event names |
| `checkConsent` | `() => boolean` | `() => true` | Callback to check user consent before sending events |

### Full Configuration Example

```typescript
const clarityHook = new ClarityHook({
  enabled: process.env.NODE_ENV === 'production',
  eventPrefix: 'FF:',
  checkConsent: () => {
    // Integrate with your consent management platform
    return window.cookieConsent?.analytics ?? false;
  }
});
```

## What Gets Tracked

When a feature flag is evaluated and the result is `true`, a Clarity custom event is sent:

```
clarity("event", "FeatureFlag:new-checkout-flow")
clarity("event", "FeatureFlag:dark-mode")
clarity("event", "FeatureFlag:premium-features")
```

### What is NOT tracked
- Feature flags that evaluate to `false`
- Any events when the hook is disabled
- Any events when consent is denied
- Any events when Clarity SDK is not loaded

## Viewing Data in Clarity

### Custom Events
1. Go to your Clarity dashboard
2. Navigate to **Recordings** or **Heatmaps**
3. Use **Filters** to filter by custom events
4. Look for events matching your prefix (e.g., `FeatureFlag:*`)

### Session Insights
Feature flag events appear in the session recording timeline, allowing you to see exactly when features were evaluated during a user's session.

## Privacy & Consent

### GDPR/CCPA Compliance

The `checkConsent` callback allows integration with consent management platforms:

```typescript
// OneTrust example
new ClarityHook({
  checkConsent: () => window.OneTrust?.IsAlertBoxClosed() &&
                      window.OneTrust?.GetDomainData()?.Groups
                        ?.find(g => g.CustomGroupId === 'C0002')?.Status === 'active'
});

// Simple cookie consent example
new ClarityHook({
  checkConsent: () => document.cookie.includes('analytics_consent=true')
});
```

### What data is sent
- Only the feature flag key name (e.g., `"dark-mode"`)
- No user identifiers, no evaluation context, no PII
- Data follows Microsoft Clarity's privacy and retention policies

## Error Handling

The hook is designed to never break the Toggly SDK:
- All Clarity API calls are wrapped in try-catch
- If Clarity is not loaded, events are silently skipped
- If Clarity throws an error, it is caught and logged to console
- The hook provides a console warning (not error) if Clarity is not detected at initialization

## Performance

- **Overhead**: <0.1ms per evaluation (immediate, no batching)
- **Bundle Size**: ~1KB (minified)
- **No batching**: Events are sent immediately; Clarity handles its own internal queuing
- **Short-circuit**: Disabled hooks and false results exit immediately with zero overhead

## Dynamic Hook Management

You can add or remove the hook at runtime:

```typescript
import { Toggly } from '@ops-ai/feature-flags-toggly';
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';

// Add hook after initialization
Toggly.addHook(new ClarityHook());

// Remove hook by name
Toggly.removeHook('clarity-hook');
```

## Troubleshooting

### Events not appearing in Clarity

1. **Check Clarity is loaded**: Ensure the Clarity tracking code is on the page before Toggly initializes
   ```javascript
   console.log('Clarity available:', typeof window.clarity === 'function');
   ```

2. **Check consent**: Verify your `checkConsent` callback returns `true`

3. **Check feature evaluation**: Ensure your feature flags are actually evaluating to `true`

4. **Check the console**: Look for `[Toggly Clarity Hook]` messages

### Console warning at startup

```
[Toggly Clarity Hook] Microsoft Clarity not detected.
```

This means Clarity was not loaded when the hook was created. The hook will automatically start sending events once Clarity becomes available (e.g., loaded asynchronously).

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
import { ClarityHook } from '@ops-ai/toggly-clarity-hook';
import type { ClarityHookOptions } from '@ops-ai/toggly-clarity-hook';

const options: ClarityHookOptions = {
  enabled: true,
  eventPrefix: 'FF:',
  checkConsent: () => true,
};

const hook = new ClarityHook(options);
```

## Requirements

- **Toggly SDK**: Any JS SDK v1.0.0+ with hooks support
- **Microsoft Clarity**: Latest version
- **Browser**: Modern browsers with ES2020+ support
- **Node.js**: 18+ (for development)

## Related Packages

- [@ops-ai/toggly-hooks-types](https://www.npmjs.com/package/@ops-ai/toggly-hooks-types) - Hook type definitions
- [@ops-ai/feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/feature-flags-toggly) - Core JavaScript SDK
- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/ngx-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/ngx-feature-flags-toggly) - Angular SDK

## Find Out More

- [Toggly Documentation](https://docs.toggly.io)
- [Microsoft Clarity Docs](https://learn.microsoft.com/en-us/clarity/)
- [Toggly Hooks Guide](https://docs.toggly.io/hooks)

## License

MIT
