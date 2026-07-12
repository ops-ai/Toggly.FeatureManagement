# Toggly Nuxt SDK

Feature flags for Nuxt 3 applications with SSR/SSG support, auto-imported composables, components, directives, and server utilities.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/nuxt-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/nuxt-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## What is a Feature Flag

A feature flag (or toggle) is a mechanism that allows you to enable or disable features in your application without deploying new code. Feature flags help you:

- **Ship faster**: Deploy code with features disabled, then enable them when ready
- **Reduce risk**: Gradually roll out features to a subset of users
- **A/B testing**: Test different variations with different user groups
- **Kill switch**: Instantly disable problematic features in production

## Architecture

The Nuxt SDK is modular with 4 packages:

```
@ops-ai/nuxt-toggly          # Main Nuxt module (orchestrates everything)
├── @ops-ai/nuxt-toggly-core    # Zero dependencies, shared types & utilities
├── @ops-ai/nuxt-toggly-server  # Server-side: Nitro middleware, route handlers
└── @ops-ai/nuxt-toggly-client  # Client-side: Vue 3 composables, components, directives
```

### Benefits

- ✅ Server-only API routes don't bundle Vue
- ✅ Client code doesn't bundle server utilities
- ✅ Minimal dependencies per package
- ✅ Tree-shakeable
- ✅ Full TypeScript support

## Installation

```bash
# Full Nuxt module (recommended)
npm install @ops-ai/nuxt-toggly

# Or install specific packages
npm install @ops-ai/nuxt-toggly-core @ops-ai/nuxt-toggly-server  # Server-only
npm install @ops-ai/nuxt-toggly-core @ops-ai/nuxt-toggly-client  # Client-only
```

## Quick Start

### 1. Add to nuxt.config.ts

```typescript
export default defineNuxtConfig({
  modules: ['@ops-ai/nuxt-toggly'],

  toggly: {
    appKey: process.env.TOGGLY_APP_KEY,
    environment: 'Production',
  },
})
```

### 2. Use in Components

```vue
<script setup>
// Composables are auto-imported!
const { isEnabled } = useFeatureFlag('new-dashboard')
</script>

<template>
  <NewDashboard v-if="isEnabled" />
  <OldDashboard v-else />
</template>
```

### 3. Use Feature Component

```vue
<template>
  <Feature feature-key="beta-feature">
    <template #default>
      <BetaContent />
    </template>
    <template #fallback>
      <StableContent />
    </template>
  </Feature>
</template>
```

## Configuration Options

```typescript
export default defineNuxtConfig({
  toggly: {
    // Required for Toggly.io (optional for local-only)
    appKey: 'your-app-key',

    // Environment name (default: 'Production')
    environment: 'Production',

    // API base URL (default: 'https://client.toggly.io')
    baseUri: 'https://client.toggly.io',

    // User identity for targeting
    identity: undefined,

    // Default values when API is unavailable
    featureDefaults: {
      'my-feature': true,
    },

    // Show content while evaluating (default: false)
    showFeatureDuringEvaluation: false,

    // Auto-refresh interval in ms (default: 180000 - 3 min)
    refreshInterval: 180000,

    // Enable SSR (default: true)
    ssr: true,

    // Cache features on server (default: true)
    serverCache: true,

    // Server cache TTL in ms (default: 60000 - 1 min)
    serverCacheTtl: 60000,

    // Persist identity to localStorage (default: true)
    persistIdentity: true,

    // Persist features for offline support (default: false)
    persistFeatures: false,

    // Auto-import composables (default: true)
    autoImport: true,

    // Register global components (default: true)
    globalComponents: true,

    // Register global directives (default: true)
    globalDirectives: true,

    // Enable debug logging (default: false)
    debug: false,
  },
})
```

## Client-Side Usage

### Composables

```vue
<script setup>
// Get full Toggly instance
const { isReady, features, refresh, setIdentity } = useToggly()

// Check single feature
const { isEnabled, isLoading } = useFeatureFlag('my-feature')

// Check if feature is OFF (inverted)
const { isEnabled: showWhenOff } = useFeatureOff('maintenance-mode')

// Check multiple features
const { isEnabled: hasAll } = useFeatureGate(['feature-a', 'feature-b'], 'all')
const { isEnabled: hasAny } = useFeatureGate(['feature-a', 'feature-b'], 'any')

// Negate (show when features are OFF)
const { isEnabled: showFallback } = useFeatureGate(['beta'], 'all', true)
</script>
```

### Components

```vue
<template>
  <!-- Single feature -->
  <Feature feature-key="new-ui">
    <NewUI />
  </Feature>

  <!-- Multiple features (all required) -->
  <Feature :feature-keys="['feature-a', 'feature-b']" requirement="all">
    <FullExperience />
  </Feature>

  <!-- Any feature enabled -->
  <Feature :feature-keys="['feature-a', 'feature-b']" requirement="any">
    <PartialExperience />
  </Feature>

  <!-- With fallback slot -->
  <Feature feature-key="beta">
    <template #default>
      <BetaContent />
    </template>
    <template #fallback>
      <StableContent />
    </template>
    <template #loading>
      <LoadingSpinner />
    </template>
  </Feature>

  <!-- Negated (show when disabled) -->
  <Feature feature-key="maintenance" negate>
    <MainContent />
  </Feature>

  <!-- Convenience components -->
  <FeatureEnabled feature-key="promo">
    <PromoBanner />
  </FeatureEnabled>

  <FeatureDisabled feature-key="promo">
    <p>No promo available</p>
  </FeatureDisabled>
</template>
```

### Directives

```vue
<template>
  <!-- Simple feature check -->
  <div v-feature="'new-feature'">
    New feature content
  </div>

  <!-- Object syntax with options -->
  <div v-feature="{ key: 'feature', requirement: 'all', negate: false }">
    Content
  </div>

  <!-- Multiple features -->
  <div v-feature="['feature-a', 'feature-b']">
    Both required
  </div>

  <!-- Using modifiers -->
  <div v-feature.any="['feature-a', 'feature-b']">
    Any feature enabled
  </div>

  <div v-feature.not="'beta-feature'">
    Show when beta is disabled
  </div>

  <!-- Use visibility instead of display -->
  <div v-feature-show="'my-feature'">
    Uses visibility: hidden (keeps layout space)
  </div>

  <!-- Toggle class based on feature -->
  <div v-feature-class:enabled="'dark-mode'">
    Has 'enabled' class when feature is on
  </div>
</template>
```

## Server-Side Usage

### API Route Handlers

```typescript
// server/api/beta-data.ts
export default defineFeatureHandler('beta-api', async (event) => {
  // Only executed if 'beta-api' feature is enabled
  return { data: 'beta content' }
})
```

### Middleware

```typescript
// server/middleware/admin.ts
export default defineFeatureMiddleware({
  featureKey: 'admin-panel',
  statusCode: 404,
  message: 'Not found',
})
```

### In Event Handlers

```typescript
// server/api/features.ts
export default defineEventHandler(async (event) => {
  // Check feature for current request
  if (await isEventFeatureOn(event, 'new-api')) {
    return { version: 2 }
  }
  return { version: 1 }
})
```

### Server Utilities

```typescript
// server/api/data.ts
export default defineEventHandler(async (event) => {
  const toggly = useEventToggly(event)

  const features = {
    newApi: await toggly.isFeatureOn('new-api'),
    betaMode: await toggly.isFeatureOn('beta-mode'),
  }

  return { features }
})
```

## Users and Rollouts

Set user identity for percentage-based rollouts and targeting:

```vue
<script setup>
const { setIdentity } = useToggly()

// After user login
await setIdentity('user-123')
</script>
```

Or configure globally:

```typescript
export default defineNuxtConfig({
  toggly: {
    appKey: 'your-app-key',
    identity: 'user-123',
  },
})
```

## Basic Usage (without Toggly.io)

Use feature defaults without connecting to Toggly.io:

```typescript
export default defineNuxtConfig({
  toggly: {
    // No appKey - works offline
    featureDefaults: {
      'new-dashboard': true,
      'beta-feature': false,
      'dark-mode': true,
    },
  },
})
```

## TypeScript Support

All packages are fully typed. Import types as needed:

```typescript
import type {
  TogglyConfig,
  TogglyClient,
  FeatureRequirement,
  Hook,
} from '@ops-ai/nuxt-toggly'
```

## Hooks System

Extend Toggly with custom hooks:

```typescript
import type { Hook } from '@ops-ai/nuxt-toggly'

const analyticsHook: Hook = {
  getMetadata: () => ({ name: 'analytics' }),

  async afterEvaluation(flagKey, data, result) {
    analytics.track('feature_evaluated', {
      flag: flagKey,
      enabled: result,
    })
  },

  async afterRefresh(flags) {
    console.log('Features refreshed:', flags)
  },
}

export default defineNuxtConfig({
  toggly: {
    appKey: 'your-key',
    hooks: [analyticsHook],
  },
})
```

## Best Practices

### 1. Environment-Based Configuration

```typescript
export default defineNuxtConfig({
  toggly: {
    appKey: process.env.TOGGLY_APP_KEY,
    environment: process.env.NODE_ENV === 'production'
      ? 'Production'
      : 'Staging',
  },
})
```

### 2. Fail-Safe Defaults

```typescript
export default defineNuxtConfig({
  toggly: {
    featureDefaults: {
      'critical-checkout': true,   // Always allow checkout
      'maintenance-mode': false,   // Never show maintenance by default
    },
  },
})
```

### 3. Loading States

```vue
<template>
  <Feature feature-key="new-feature">
    <template #loading>
      <SkeletonLoader />
    </template>
    <template #default>
      <NewFeature />
    </template>
  </Feature>
</template>
```

### 4. Server-Side Feature Gates

```typescript
// Protect entire API routes
export default defineFeatureHandler('premium-api', async (event) => {
  // Only premium users with feature enabled
  return getPremiumData()
}, {
  statusCode: 403,
  message: 'Premium feature not available',
})
```

## Requirements

- Node.js 18+
- Nuxt 3+
- Vue 3.3+

## License

MIT © [OpsAI](https://ops.ai)

## Find out more

- [Documentation](https://docs.toggly.io/sdks/nuxt)
- [Toggly.io](https://toggly.io)
- [GitHub](https://github.com/ops-ai/toggly-sdks)
