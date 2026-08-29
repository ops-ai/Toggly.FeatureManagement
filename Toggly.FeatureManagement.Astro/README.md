# Toggly Astro SDK

Feature flag management for Astro applications with support for SSR, SSG, and client-side rendering.

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/astro-feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/astro-feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Features

- 🚀 **Native Astro Components** - Server-rendered `.astro` components for optimal performance
- 🏝️ **Island Architecture** - Client-side hydration with Astro islands
- ⚛️ **Framework Support** - React, Vue, and Svelte component wrappers
- 📄 **Page-Level Gating** - Control entire pages via frontmatter
- 🔄 **SSR & SSG Support** - Works seamlessly with both rendering modes
- 🎯 **User Targeting** - Identity-based feature rollouts
- ⚡ **Lightweight** - Minimal client bundle using nanostores (~300 bytes)
- 🔌 **Edge Ready** - Optional Cloudflare Worker integration

## Installation

```bash
npm install @ops-ai/astro-feature-flags-toggly
```

## Quick Start

### 1. Add the Integration

In your `astro.config.mjs`:

```javascript
import { defineConfig } from 'astro/config';
import togglyIntegration from '@ops-ai/astro-feature-flags-toggly/integration';

export default defineConfig({
  integrations: [
    togglyIntegration({
      appKey: process.env.TOGGLY_APP_KEY,
      environment: process.env.TOGGLY_ENVIRONMENT || 'Production',
      baseURI: 'https://client.toggly.io',
      flagDefaults: {
        // Fallback values when API is unavailable
        'example-feature': false,
      },
      isDebug: process.env.NODE_ENV === 'development',
    }),
  ],
});
```

### 2. Configure Middleware

Create or update `src/middleware.ts`:

```typescript
import { sequence } from 'astro:middleware';
import { createTogglyMiddleware } from '@ops-ai/astro-feature-flags-toggly';

const toggly = createTogglyMiddleware({
  appKey: import.meta.env.TOGGLY_APP_KEY,
  environment: import.meta.env.TOGGLY_ENVIRONMENT || 'Production',
});

export const onRequest = sequence(toggly);
```

### 3. Use the Feature Component

In your `.astro` files:

```astro
---
import Feature from '@ops-ai/astro-feature-flags-toggly/components/Feature.astro';
---

<Feature flag="new-dashboard">
  <h1>New Dashboard</h1>
  <p>This content is only visible when the feature is enabled</p>
</Feature>
```

## Usage

### Server-Side Components (Recommended)

Use the `Feature.astro` component for server-side evaluation (SSR/SSG):

```astro
---
import Feature from '@ops-ai/astro-feature-flags-toggly/components/Feature.astro';
---

<!-- Single flag -->
<Feature flag="beta-feature">
  <p>Beta content</p>
</Feature>

<!-- Multiple flags with 'all' requirement -->
<Feature flags={['feature1', 'feature2']}>
  <p>Both features must be enabled</p>
</Feature>

<!-- Multiple flags with 'any' requirement -->
<Feature flags={['feature1', 'feature2']} requirement="any">
  <p>At least one feature must be enabled</p>
</Feature>

<!-- With fallback content -->
<Feature flag="premium-feature">
  <p>Premium content</p>
  <div slot="fallback">
    <p>Upgrade to unlock this feature</p>
  </div>
</Feature>

<!-- Negated (show when disabled) -->
<Feature flag="old-feature" negate={true}>
  <p>This shows when the feature is OFF</p>
</Feature>
```

### Client-Side Components (Islands)

Use `FeatureClient.astro` for client-side evaluation with hydration:

```astro
---
import FeatureClient from '@ops-ai/astro-feature-flags-toggly/components/FeatureClient.astro';
---

<!-- Hydrate on page load -->
<FeatureClient flag="interactive-widget" client="load">
  <InteractiveWidget />
</FeatureClient>

<!-- Lazy hydration when visible -->
<FeatureClient flag="below-fold-content" client="visible">
  <HeavyComponent />
</FeatureClient>

<!-- Hydrate when browser is idle -->
<FeatureClient flag="non-critical-feature" client="idle">
  <NonCriticalContent />
</FeatureClient>
```

### Page-Level Gating

Control entire pages using frontmatter:

```astro
---
// src/pages/beta-feature.astro
x-feature: beta-feature
---

<html>
  <body>
    <h1>Beta Feature Page</h1>
    <p>This entire page is gated by the 'beta-feature' flag</p>
  </body>
</html>
```

During build, the integration generates a `toggly-page-features.json` manifest that can be used with a Cloudflare Worker for true edge enforcement (404s for disabled pages).

### React Integration

Use in React islands:

```tsx
// Component.tsx
import { Feature, useFeatureFlag } from '@ops-ai/astro-feature-flags-toggly/react';

// With component
export function Dashboard() {
  return (
    <Feature flag="new-dashboard">
      <NewDashboard />
    </Feature>
  );
}

// With hook
export function ConditionalContent() {
  const { enabled, isReady } = useFeatureFlag('premium-feature');

  if (!isReady) return <Loading />;
  if (!enabled) return <FreeTier />;
  return <PremiumTier />;
}
```

In your Astro file:

```astro
---
import Dashboard from '../components/Dashboard.tsx';
---

<Dashboard client:load />
```

### Vue Integration

```vue
<!-- Component.vue -->
<script setup>
import Feature from '@ops-ai/astro-feature-flags-toggly/vue/Feature.vue';
import { useFeatureFlag } from '@ops-ai/astro-feature-flags-toggly/vue';

const { enabled } = useFeatureFlag('new-feature');
</script>

<template>
  <Feature flag="beta-widget">
    <BetaWidget />
    <template #fallback>
      <ComingSoon />
    </template>
  </Feature>

  <div v-if="enabled">
    <p>Feature-controlled content</p>
  </div>
</template>
```

### Svelte Integration

```svelte
<!-- Component.svelte -->
<script>
import Feature from '@ops-ai/astro-feature-flags-toggly/svelte/Feature.svelte';
import { featureFlag } from '@ops-ai/astro-feature-flags-toggly/svelte';

const newDashboard = featureFlag('new-dashboard');
</script>

<Feature flag="beta-feature">
  <BetaContent />
  <svelte:fragment slot="fallback">
    <RegularContent />
  </svelte:fragment>
</Feature>

{#if $newDashboard}
  <NewDashboard />
{:else}
  <OldDashboard />
{/if}
```

## Configuration Options

```typescript
interface TogglyConfig {
  /** Base URI for the Toggly API (default: 'https://client.toggly.io') */
  baseURI?: string;
  
  /** Application key from Toggly */
  appKey?: string;
  
  /** Environment name (default: 'Production') */
  environment?: string;
  
  /** Default flag values to use when API is unavailable */
  flagDefaults?: Record<string, boolean>;
  
  /** Feature flags refresh interval in milliseconds (default: 180000 = 3 minutes) */
  featureFlagsRefreshInterval?: number;

  /**
   * When true (default), the browser client connects to the definitions WebSocket
   * for live flag updates. Set false to rely on polling only.
   */
  enableLiveUpdates?: boolean;
  
  /** Enable debug logging (default: false) */
  isDebug?: boolean;
  
  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;
  
  /** User identity for targeting (optional) */
  identity?: string;
  
  /**
   * When true, all features are enabled during build time (SSG).
   * This is useful when you have an edge worker (like Cloudflare Worker) that
   * filters content based on feature flags at runtime.
   * During dev server, actual feature flags from the API are still used.
   * (default: false)
   */
  allFeaturesEnabledDuringBuild?: boolean;
}
```

## Build Mode for Edge Filtering

If you're using an edge worker (Cloudflare Worker, Vercel Edge, etc.) to filter content based on feature flags at runtime, you can enable all features during the static build:

```javascript
// astro.config.mjs
const isDev = process.env.NODE_ENV === 'development';
const isBuild = process.argv.includes('build');

export default defineConfig({
  integrations: [
    togglyIntegration({
      appKey: process.env.TOGGLY_APP_KEY,
      environment: process.env.TOGGLY_ENVIRONMENT || 'Production',
      baseURI: 'https://client.toggly.io',
      // Enable all features during production builds
      // Use actual feature flags during development
      allFeaturesEnabledDuringBuild: isBuild && !isDev,
      isDebug: isDev,
    }),
  ],
});
```

**Benefits:**
- **SEO**: All feature-flagged content is present in the static build for search engines
- **No broken links**: Features disabled during build won't cause broken internal links
- **Edge performance**: Static build generated once, edge worker does lightweight filtering
- **Dynamic control**: Toggle features at the edge without rebuilding
- **Dev experience**: See actual feature states during local development

**How it works:**
1. **Development** (`npm run dev`): Fetches actual feature flags from Toggly API
2. **Build** (`npm run build`): Builds static site with all features enabled
3. **Runtime** (Edge/CDN): Edge worker filters content based on current feature flag states

## SSR vs SSG Considerations

### SSR (Server-Side Rendering)

- Flags are fetched on each request
- Fresh flag values for every visitor
- Slightly slower initial page load
- Use `output: 'server'` in `astro.config.mjs`

```javascript
export default defineConfig({
  output: 'server',
  // ...
});
```

### SSG (Static Site Generation)

- Flags are fetched at build time
- Same flag values for all visitors
- Fastest possible page loads
- Requires rebuild to update flags
- Use client-side components for dynamic updates

```javascript
export default defineConfig({
  output: 'static',
  // ...
});
```

### Hybrid Approach

Use server components for critical gating and client components for non-critical features:

```astro
---
import Feature from '@ops-ai/astro-feature-flags-toggly/components/Feature.astro';
import FeatureClient from '@ops-ai/astro-feature-flags-toggly/components/FeatureClient.astro';
---

<!-- Critical feature - evaluated at build/request time -->
<Feature flag="access-control">
  <SecureContent />
</Feature>

<!-- Non-critical feature - evaluated on client -->
<FeatureClient flag="ui-enhancement" client="idle">
  <EnhancedUI />
</FeatureClient>
```

## Advanced Usage

### User Identity for Targeting

```typescript
// In middleware or component
import { setIdentity } from '@ops-ai/astro-feature-flags-toggly';

// Set user identity for targeting
setIdentity('user-123');

// Clear identity (e.g., on logout)
import { clearIdentity } from '@ops-ai/astro-feature-flags-toggly';
clearIdentity();
```

### Manual Flag Refresh

```typescript
import { refreshFlags } from '@ops-ai/astro-feature-flags-toggly';

// Manually refresh flags
await refreshFlags();
```

### Live updates (browser client)

Hydrated islands use the definitions WebSocket by default (`enableLiveUpdates: true`).
When connected, HTTP polling becomes a rare 20-minute fallback. Set
`enableLiveUpdates: false` to poll only.

**Server helpers (`TogglyServer` / middleware)** remain request-scoped with a TTL
cache — they do not hold a long-lived WebSocket. For long-lived Node processes
that need live sync, use `@ops-ai/toggly-node-core` (or another Node SDK) instead
of relying on Astro SSR helpers.

### Programmatic Flag Evaluation

In server-side code:

```typescript
const toggly = Astro.locals.toggly;

const isEnabled = await toggly.getFlag('feature-key');
const allFlags = await toggly.getFlags();
```

## Edge Enforcement (Optional)

For true enforcement at the edge (prevents page access even if client-side JS is disabled):

1. The integration generates `toggly-page-features.json` during build
2. Deploy a Cloudflare Worker that reads this manifest
3. The worker intercepts requests and returns 404 for disabled pages

See the [Cloudflare Worker integration guide](https://github.com/ops-ai/Toggly.CloudflareWorker) for setup instructions.

## TypeScript Support

Full TypeScript support is included:

```typescript
import type {
  TogglyConfig,
  Flags,
  TogglyClient,
  FeatureProps,
} from '@ops-ai/astro-feature-flags-toggly';

// Augmented Astro global
Astro.locals.toggly; // Typed as TogglyClient
```

## Best Practices

1. **Use Server Components When Possible** - Better performance, no client-side JavaScript
2. **Set Flag Defaults** - Always provide fallback values for offline scenarios
3. **Use Environment Variables** - Never hardcode credentials
4. **Enable Debug Mode in Development** - Helps troubleshoot issues
5. **Cache Appropriately** - Adjust `featureFlagsRefreshInterval` based on your needs
6. **Provide User Identity** - Required for targeting and consistent rollouts
7. **Consider SSR vs SSG** - Choose based on how dynamic your flags need to be
8. **Use Page-Level Gating** - For entire pages, use frontmatter instead of wrapping all content

## Troubleshooting

### Flags not loading

1. Check that the integration is properly configured in `astro.config.mjs`
2. Verify `appKey` and `environment` are correct
3. Enable debug mode: `isDebug: true`
4. Check browser console and server logs

### TypeScript errors

Make sure you have the necessary dependencies:

```bash
npm install -D @types/node astro
```

### Client components not hydrating

Ensure you're using the correct hydration directive:

```astro
<FeatureClient flag="test" client="load">
  <!-- content -->
</FeatureClient>
```

### Middleware not working

Verify middleware is properly configured in `src/middleware.ts` and exported as `onRequest`.

## Examples

Check the `examples/` directory for complete working examples:

- Basic Astro + Toggly setup
- SSR with feature flags
- SSG with client-side updates
- React/Vue/Svelte islands

## License

MIT

## Support

- [Documentation](https://docs.toggly.io)
- [GitHub Issues](https://github.com/ops-ai/Toggly.FeatureManagement/issues)
- [Discord Community](https://discord.gg/toggly)

## Related

- [@ops-ai/toggly-docusaurus-plugin](https://www.npmjs.com/package/@ops-ai/toggly-docusaurus-plugin) - Docusaurus integration
- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/feature-flags-toggly) - Vanilla JavaScript SDK

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
import type { Hook } from '@ops-ai/toggly-hooks-types';

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

**During initialization in astro.config:**

```typescript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import toggly from '@ops-ai/astro-feature-flags-toggly';

export default defineConfig({
  integrations: [
    toggly({
      appKey: 'your-app-key',
      environment: 'your-environment-name',
      hooks: [myAnalyticsHook]
    })
  ]
});
```

**At runtime (client-side):**

```typescript
import { togglyStore } from '@ops-ai/astro-feature-flags-toggly/client';
import { get } from 'svelte/store';

const store = get(togglyStore);

// Add a hook
store.hookExecutor.addHook(myAnalyticsHook);

// Remove a hook
store.hookExecutor.removeHook(myAnalyticsHook);
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

Pass the page entity on each `getFlag` / `evaluateGate` call. User identity is separate from entity context. Register mappers with `registerContext` locally — this client does not PUT entity schemas.

Entity gates fail closed without context. Edge and middleware paths that flatten defs to booleans collapse gated flags to `false`. See [Entity & page context](https://docs.toggly.io/docs/core-concepts/entity-context).

```ts
toggly.registerContext('Product', (product) => ({
  kind: 'Product',
  key: String(product.id),
  attributes: { Category: product.category },
}));

const enabled = await toggly.getFlag('NewBadge', false, product, 'Product');
```

## Related SDKs

- [@ops-ai/react-feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/react-feature-flags-toggly) - React SDK
- [@ops-ai/feature-flags-toggly](https://www.npmjs.com/package/@ops-ai/feature-flags-toggly) - Vanilla JavaScript SDK


