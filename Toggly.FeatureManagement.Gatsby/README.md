# Toggly Feature Flags SDK for Gatsby

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/gatsby-feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/gatsby-feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

A comprehensive Gatsby plugin for [Toggly](https://toggly.io) feature flags with support for SSR, SSG, build-time page gating, and edge worker filtering.

## Features

- 🚀 **Gatsby Plugin Integration** - Automatic setup via `gatsby-config.js`
- ⚛️ **Modern React Hooks** - `useFeatureFlag`, `useFeatureGate`, `useToggly`
- 🧩 **React Components** - `<Feature>`, `<FeatureGate>`, `<TogglyProvider>`
- 🏗️ **Build-Time Page Gating** - Extract feature requirements from page frontmatter
- 🌐 **Hybrid Approach** - Build with all features enabled, filter at edge/runtime
- 🔄 **Reactive State** - Powered by nanostores for minimal bundle size
- 📦 **TypeScript Support** - Full type definitions included
- 🎯 **User Targeting** - Identity-based feature rollouts
- ⚡ **Edge Worker Ready** - Generate manifests for Cloudflare Workers

## Installation

```bash
npm install @ops-ai/gatsby-feature-flags-toggly
```

## Quick Start

### 1. Configure the Plugin

Add the plugin to your `gatsby-config.js`:

```javascript
module.exports = {
  plugins: [
    {
      resolve: '@ops-ai/gatsby-feature-flags-toggly',
      options: {
        appKey: 'your-app-key', // Get this from toggly.io
        environment: 'Production', // Optional, defaults to 'Production'
        allFeaturesEnabledDuringBuild: true, // Optional, for hybrid approach
        flagDefaults: {
          // Optional fallback values
          'my-feature': false,
        },
      },
    },
  ],
};
```

### 2. Use in Components

#### Using Hooks

```tsx
import { useFeatureFlag } from '@ops-ai/gatsby-feature-flags-toggly';

function MyComponent() {
  const { isEnabled, isReady, error } = useFeatureFlag('new-dashboard');

  if (!isReady) return <Loading />;
  if (error) return <ErrorMessage />;

  return isEnabled ? <NewDashboard /> : <OldDashboard />;
}
```

#### Using Components

```tsx
import { Feature } from '@ops-ai/gatsby-feature-flags-toggly';

function MyPage() {
  return (
    <div>
      <Feature flag="new-header">
        <NewHeader />
      </Feature>

      <Feature flag="beta-feature" fallback={<ComingSoon />}>
        <BetaContent />
      </Feature>
    </div>
  );
}
```

### 3. Page-Level Gating

Add `x-feature` to your page frontmatter:

```mdx
---
title: Beta Features
x-feature: beta-access
---

# Beta Features

This page requires the 'beta-access' feature flag.
```

During build, the plugin generates a `toggly-page-features.json` manifest that maps pages to required features, enabling edge worker filtering.

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appKey` | `string` | **required** | Your Toggly application key |
| `environment` | `string` | `'Production'` | Environment name (e.g., 'Staging', 'Dev') |
| `baseURI` | `string` | `'https://client.toggly.io'` | Toggly API base URL |
| `flagDefaults` | `object` | `{}` | Default flag values when API unavailable |
| `featureFlagsRefreshInterval` | `number` | `180000` | Client refresh interval (ms) |
| `allFeaturesEnabledDuringBuild` | `boolean` | `false` | Enable all features during build |
| `identity` | `string` | `undefined` | User identity for targeting |
| `isDebug` | `boolean` | `false` | Enable debug logging |
| `connectTimeout` | `number` | `5000` | API connection timeout (ms) |

## API Reference

### Hooks

#### `useFeatureFlag(flagKey, defaultValue?)`

Check if a single feature flag is enabled.

```tsx
const { isEnabled, isReady, error } = useFeatureFlag('my-feature', false);
```

**Parameters:**
- `flagKey` (string): Feature flag key
- `defaultValue` (boolean, optional): Default value if flag not found

**Returns:**
- `isEnabled` (boolean): Whether the flag is enabled
- `isReady` (boolean): Whether flags have been loaded
- `error` (Error | null): Error if loading failed

#### `useFeatureGate(flagKeys, requirement?, negate?)`

Check multiple feature flags with gate logic.

```tsx
const { isEnabled, isReady, error } = useFeatureGate(
  ['feature1', 'feature2'],
  'all', // or 'any'
  false // negate
);
```

**Parameters:**
- `flagKeys` (string[]): Array of feature flag keys
- `requirement` ('all' | 'any', optional): Gate requirement (default: 'all')
- `negate` (boolean, optional): Negate the result (default: false)

**Returns:**
- `isEnabled` (boolean): Whether the gate condition is met
- `isReady` (boolean): Whether flags have been loaded
- `error` (Error | null): Error if loading failed

#### `useToggly()`

Access the full Toggly store and utilities.

```tsx
const {
  flags,
  isReady,
  error,
  refreshFlags,
  setIdentity,
  clearIdentity,
} = useToggly();
```

**Returns:**
- `flags` (object): All feature flags
- `isReady` (boolean): Whether flags have been loaded
- `error` (Error | null): Error if loading failed
- `refreshFlags` (function): Manually refresh flags
- `setIdentity` (function): Set user identity for targeting
- `clearIdentity` (function): Clear user identity

### Components

#### `<Feature>`

Conditionally render content based on a feature flag.

```tsx
<Feature flag="my-feature" fallback={<Loading />}>
  <Content />
</Feature>
```

**Props:**
- `flag` (string): Feature flag key
- `fallback` (ReactNode, optional): Content when flag is disabled
- `children` (ReactNode): Content when flag is enabled

#### `<FeatureGate>`

Conditionally render content based on multiple feature flags.

```tsx
<FeatureGate
  flags={['feature1', 'feature2']}
  requirement="all"
  negate={false}
  fallback={<Restricted />}
>
  <Content />
</FeatureGate>
```

**Props:**
- `flags` (string[]): Array of feature flag keys
- `requirement` ('all' | 'any', optional): Gate requirement (default: 'all')
- `negate` (boolean, optional): Negate the result (default: false)
- `fallback` (ReactNode, optional): Content when gate is not met
- `children` (ReactNode): Content when gate is met

#### `<TogglyProvider>`

Provider component (automatically wrapped by plugin).

```tsx
<TogglyProvider config={options}>
  <App />
</TogglyProvider>
```

> **Note:** When using the Gatsby plugin, you don't need to manually wrap your app with `TogglyProvider`. The plugin handles this automatically.

## Advanced Usage

### User Targeting

Set user identity for targeted feature rollouts:

```tsx
import { useToggly } from '@ops-ai/gatsby-feature-flags-toggly';

function UserProfile({ userId }) {
  const { setIdentity } = useToggly();

  useEffect(() => {
    setIdentity(userId);
  }, [userId, setIdentity]);

  return <Profile />;
}
```

### Manual Flag Refresh

Manually refresh flags without waiting for the refresh interval:

```tsx
import { useToggly } from '@ops-ai/gatsby-feature-flags-toggly';

function RefreshButton() {
  const { refreshFlags } = useToggly();

  const handleRefresh = async () => {
    await refreshFlags();
  };

  return <button onClick={handleRefresh}>Refresh Flags</button>;
}
```

### Direct Store Access

For advanced use cases, access the nanostores directly:

```tsx
import { useStore } from '@nanostores/react';
import { $flags, $flag } from '@ops-ai/gatsby-feature-flags-toggly';

function AdvancedComponent() {
  // Access all flags
  const allFlags = useStore($flags);

  // Access specific flag as computed atom
  const isEnabled = useStore($flag('my-feature', false));

  return <div>{/* ... */}</div>;
}
```

## Build-Time Strategy: Hybrid Approach

The recommended approach for Gatsby sites:

### 1. Enable All Features During Build

```javascript
// gatsby-config.js
module.exports = {
  plugins: [
    {
      resolve: '@ops-ai/gatsby-feature-flags-toggly',
      options: {
        appKey: 'your-app-key',
        allFeaturesEnabledDuringBuild: true, // ← Enable this
      },
    },
  ],
};
```

### 2. Benefits

- **SEO-Friendly**: All content is in the static HTML
- **No Broken Links**: All pages are built and accessible
- **Dynamic Control**: Features can be toggled without rebuilding
- **Edge Enforcement**: Use Cloudflare Workers to filter at the edge

### 3. Edge Worker Filtering

After build, the plugin generates two manifest files in `public/`:

- `toggly-page-features.json` - Maps pages to required features
- `toggly-config.json` - Sanitized config for edge workers

Use these with a Cloudflare Worker to enforce feature gates before serving static HTML:

```javascript
// Example Cloudflare Worker
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Load page features manifest
    const manifest = await env.ASSETS.fetch('/toggly-page-features.json');
    const pageFeatures = await manifest.json();

    // Check if page requires a feature
    const requiredFeature = pageFeatures[url.pathname];

    if (requiredFeature) {
      // Fetch flags from Toggly API
      const flags = await fetchTogglyFlags(env.TOGGLY_APP_KEY);

      // If feature is disabled, return 404
      if (!flags[requiredFeature]) {
        return new Response('Not Found', { status: 404 });
      }
    }

    // Serve the static asset
    return env.ASSETS.fetch(request);
  },
};
```

## Page-Level Gating

### Using Frontmatter

For MDX or Markdown pages, add `x-feature` to frontmatter:

```mdx
---
title: Beta Page
x-feature: beta-access
---

# Beta Content
```

### Programmatic Pages

When creating pages programmatically, add `x-feature` to page context:

```javascript
// gatsby-node.js
exports.createPages = async ({ actions }) => {
  actions.createPage({
    path: '/beta',
    component: require.resolve('./src/templates/beta.js'),
    context: {
      frontmatter: {
        'x-feature': 'beta-access',
      },
    },
  });
};
```

### Generated Manifest

The plugin generates `toggly-page-features.json`:

```json
{
  "/beta": "beta-access",
  "/premium": "premium-features",
  "/new-dashboard": "new-dashboard-feature"
}
```

## TypeScript Support

The SDK includes full TypeScript definitions:

```typescript
import type {
  TogglyPluginOptions,
  Flags,
  GateRequirement,
  UseFeatureFlagResult,
  UseFeatureGateResult,
  UseTogglyResult,
} from '@ops-ai/gatsby-feature-flags-toggly';
```

## Examples

### Example 1: Feature Toggle

```tsx
import { useFeatureFlag } from '@ops-ai/gatsby-feature-flags-toggly';

function Dashboard() {
  const { isEnabled } = useFeatureFlag('new-dashboard');

  return (
    <div>
      <h1>Dashboard</h1>
      {isEnabled ? <NewDashboardWidget /> : <OldDashboardWidget />}
    </div>
  );
}
```

### Example 2: A/B Testing

```tsx
import { useFeatureFlag } from '@ops-ai/gatsby-feature-flags-toggly';

function Hero() {
  const { isEnabled: variantA } = useFeatureFlag('hero-variant-a');

  return variantA ? <HeroVariantA /> : <HeroVariantB />;
}
```

### Example 3: Gradual Rollout

```tsx
import { useEffect } from 'react';
import { useToggly } from '@ops-ai/gatsby-feature-flags-toggly';

function App({ user }) {
  const { setIdentity } = useToggly();

  useEffect(() => {
    // Set user ID for gradual rollout
    if (user?.id) {
      setIdentity(user.id);
    }
  }, [user, setIdentity]);

  return <div>{/* ... */}</div>;
}
```

### Example 4: Multiple Flag Gates

```tsx
import { FeatureGate } from '@ops-ai/gatsby-feature-flags-toggly';

function PremiumContent() {
  return (
    <FeatureGate
      flags={['premium-tier', 'beta-access']}
      requirement="any"
      fallback={<UpgradePrompt />}
    >
      <PremiumFeatures />
    </FeatureGate>
  );
}
```

### Example 5: Maintenance Mode

```tsx
import { Feature } from '@ops-ai/gatsby-feature-flags-toggly';

function App() {
  return (
    <Feature flag="maintenance-mode" fallback={<MainApp />}>
      <MaintenancePage />
    </Feature>
  );
}
```

## Troubleshooting

### Flags Not Loading

1. Check that `appKey` is correct in `gatsby-config.js`
2. Verify network connectivity to `https://client.toggly.io`
3. Enable debug mode: `isDebug: true` in plugin options
4. Check browser console for errors

### Build Errors

1. Ensure all dependencies are installed: `npm install`
2. Clear Gatsby cache: `gatsby clean`
3. Rebuild: `gatsby build`

### TypeScript Errors

1. Ensure `@types/react` is installed
2. Check `tsconfig.json` includes the SDK types
3. Restart TypeScript server in your IDE

## Contributing

Contributions are welcome! Please open an issue or pull request on [GitHub](https://github.com/ops-ai/Toggly.FeatureManagement).

## License

MIT © [Ops.AI](https://ops.ai)

## Resources

- [Toggly Dashboard](https://app.toggly.io)
- [Documentation](https://docs.toggly.io)
- [GitHub Repository](https://github.com/ops-ai/Toggly.FeatureManagement)
- [NPM Package](https://www.npmjs.com/package/@ops-ai/gatsby-feature-flags-toggly)

## Related Packages

- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/astro-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/astro-feature-flags-toggly) - Astro SDK
- [@ops-ai/ngx-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/ngx-feature-flags-toggly) - Angular SDK

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

**During initialization in gatsby-config:**

```javascript
// gatsby-config.js
module.exports = {
  plugins: [
    {
      resolve: '@ops-ai/gatsby-feature-flags-toggly',
      options: {
        appKey: 'your-app-key',
        environment: 'your-environment-name',
        hooks: [myAnalyticsHook]
      }
    }
  ]
};
```

**At runtime:**

```typescript
import { addHook, removeHook } from '@ops-ai/gatsby-feature-flags-toggly';

// Add a hook
addHook(myAnalyticsHook);

// Remove a hook
removeHook(myAnalyticsHook);
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
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Toggly]', data.featureKey, '=', data.result);
    }
  }
};
```

## Related SDKs

- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/astro-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/astro-feature-flags-toggly) - Astro SDK
- [@ops-ai/ngx-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/ngx-feature-flags-toggly) - Angular SDK
