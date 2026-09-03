# Toggly Remix SDK

Official Toggly SDK for Remix applications. Provides seamless integration of feature flags with full SSR support, client-side hydration, and React hooks.

## Packages

This SDK consists of three packages:

| Package | Description |
|---------|-------------|
| [`@ops-ai/remix-toggly-core`](./remix-toggly-core) | Shared types, utilities, and constants |
| [`@ops-ai/remix-toggly-server`](./remix-toggly-server) | Server-side utilities for loaders and actions |
| [`@ops-ai/remix-toggly-client`](./remix-toggly-client) | React components and hooks for the client |

## Installation

```bash
# Install all packages
npm install @ops-ai/remix-toggly-core @ops-ai/remix-toggly-server @ops-ai/remix-toggly-client

# Or with yarn
yarn add @ops-ai/remix-toggly-core @ops-ai/remix-toggly-server @ops-ai/remix-toggly-client

# Or with pnpm
pnpm add @ops-ai/remix-toggly-core @ops-ai/remix-toggly-server @ops-ai/remix-toggly-client
```

## Quick Start

### 1. Create a Toggly loader utility

```typescript
// app/utils/toggly.server.ts
import { createTogglyLoader } from '@ops-ai/remix-toggly-server';

export const togglyLoader = createTogglyLoader({
  appKey: process.env.TOGGLY_APP_KEY,
  environment: process.env.TOGGLY_ENVIRONMENT,
  getIdentity: async (request) => {
    // Extract user identity from session/cookie
    const session = await getSession(request.headers.get('Cookie'));
    return session.get('userId');
  },
});
```

### 2. Use in your root loader

```typescript
// app/root.tsx
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { togglyLoader } from '~/utils/toggly.server';
import { RemixTogglyProvider } from '@ops-ai/remix-toggly-client';

export async function loader({ request }: LoaderFunctionArgs) {
  const togglyData = await togglyLoader.getLoaderData({ request, params: {}, context: {} });

  return json(togglyData);
}

export default function App() {
  return (
    <html>
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <RemixTogglyProvider>
          <Outlet />
        </RemixTogglyProvider>
        <Scripts />
      </body>
    </html>
  );
}
```

### 3. Use feature flags in components

```tsx
// app/routes/dashboard.tsx
import { useFeature, Feature } from '@ops-ai/remix-toggly-client';

export default function Dashboard() {
  // Hook-based API
  const showNewDashboard = useFeature('new-dashboard');

  return (
    <div>
      {/* Hook usage */}
      {showNewDashboard ? <NewDashboard /> : <LegacyDashboard />}

      {/* On path + off path with negate (same as .NET / Next.js) */}
      <Feature featureKey="premium-analytics">
        <PremiumAnalytics />
      </Feature>
      <Feature featureKey="premium-analytics" negate>
        <BasicAnalytics />
      </Feature>

      <Feature featureKey="beta-features">
        <BetaBanner />
      </Feature>
    </div>
  );
}
```

## Server-Side Usage

### Loaders

```typescript
import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { createTogglyLoader, isFeatureEnabled } from '@ops-ai/remix-toggly-server';

// Using the loader helper
export async function loader({ request }: LoaderFunctionArgs) {
  const togglyLoader = createTogglyLoader({
    appKey: process.env.TOGGLY_APP_KEY,
  });

  // Check feature in loader
  if (await togglyLoader.isEnabled('new-api')) {
    // Fetch from new API
  }

  return togglyLoader.getLoaderData({ request, params: {}, context: {} }, {
    // Additional loader data
    items: await getItems(),
  });
}

// Standalone function
export async function loader({ request }: LoaderFunctionArgs) {
  const isPremium = await isFeatureEnabled(request, 'premium', {
    appKey: process.env.TOGGLY_APP_KEY,
  });

  return json({ isPremium });
}
```

### Actions

```typescript
import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { createFeatureGatedAction, createTogglyAction } from '@ops-ai/remix-toggly-server';

// Feature-gated action
export const action = createFeatureGatedAction(
  {
    appKey: process.env.TOGGLY_APP_KEY,
    requiredFeatures: 'premium-export',
    redirectTo: '/upgrade', // Redirect when feature disabled
  },
  async ({ request }, toggly) => {
    // This only runs if premium-export is enabled
    const formData = await request.formData();
    // ... handle export
    return json({ success: true });
  }
);

// Using action helper
const togglyAction = createTogglyAction({
  appKey: process.env.TOGGLY_APP_KEY,
});

export const action = togglyAction.requireFeature(
  'bulk-delete',
  async ({ request }, toggly) => {
    // Handle bulk delete
    return json({ deleted: true });
  },
  () => json({ error: 'Feature not available' }, { status: 403 })
);
```

## Client-Side Usage

### Hooks

```tsx
import {
  useFeature,
  useFeatureGate,
  useFeatures,
  useIdentity,
  useToggly,
  useFeatureWithLoading,
} from '@ops-ai/remix-toggly-client';

function MyComponent() {
  // Single feature
  const isEnabled = useFeature('feature-key');

  // Multiple features with requirement
  const hasAccess = useFeatureGate(['premium', 'beta'], 'all');

  // Multiple features at once
  const features = useFeatures(['feature1', 'feature2', 'feature3']);

  // Feature with loading state
  const { enabled, isLoading } = useFeatureWithLoading('feature-key');

  // Identity management
  const { identity, identify, reset } = useIdentity();

  // Full context access
  const { flags, isReady, refresh, addHook } = useToggly();
}
```

### Components

```tsx
import {
  Feature,
  FeatureSwitch,
  FeatureGate,
} from '@ops-ai/remix-toggly-client';

// Basic usage
<Feature featureKey="new-ui">
  <NewUIComponent />
</Feature>

// Off path with negate (preferred over FeatureDisabled)
<Feature featureKey="new-ui">
  <NewUI />
</Feature>
<Feature featureKey="new-ui" negate>
  <OldUI />
</Feature>

// Multiple features
<Feature featureKeys={['premium', 'analytics']} requirement="all">
  <PremiumAnalytics />
</Feature>

// Negated (show when disabled)
<Feature featureKey="maintenance" negate>
  <MainContent />
</Feature>

// Render prop
<Feature featureKey="dark-mode" render={(enabled) => (
  <div className={enabled ? 'dark' : 'light'}>Content</div>
)} />

// Dual-slot switch (kept for variant-style layouts; prefer Feature+negate for the off path)
<FeatureSwitch
  featureKey="new-checkout"
  enabled={<NewCheckout />}
  disabled={<OldCheckout />}
/>

// Gate with multiple features
<FeatureGate featureKeys={['admin', 'superuser']} requirement="any">
  <AdminPanel />
</FeatureGate>
```

## Hooks System

Add custom hooks for analytics, logging, or other integrations:

```typescript
import type { TogglyHook } from '@ops-ai/remix-toggly-client';

const analyticsHook: TogglyHook = {
  getMetadata: () => ({ name: 'analytics' }),

  beforeEvaluation: async (flagKey, defaultValue) => {
    console.log(`Evaluating: ${flagKey}`);
    return { startTime: Date.now() };
  },

  afterEvaluation: async (flagKey, data, result) => {
    analytics.track('feature_evaluated', {
      flag: flagKey,
      result,
      duration: Date.now() - (data?.startTime ?? 0),
    });
  },

  afterRefresh: async (flags) => {
    console.log('Flags refreshed:', Object.keys(flags).length);
  },
};

// In your component
const { addHook } = useToggly();
useEffect(() => {
  addHook(analyticsHook);
}, []);
```

## Configuration

### TogglyConfig Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appKey` | `string` | - | Your Toggly application key |
| `environment` | `string` | - | Environment name (e.g., 'production', 'staging') |
| `baseUrl` | `string` | `'https://app.toggly.io'` | API base URL |
| `timeout` | `number` | `5000` | Request timeout in milliseconds |
| `featureDefaults` | `FeatureFlags` | `{}` | Default feature flag values |
| `debug` | `boolean` | `false` | Enable debug logging |

### Provider Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `serverContext` | `ServerFeatureContext` | - | Server context for hydration |
| `config` | `TogglyConfig` | - | Client-side configuration |
| `enableRefresh` | `boolean` | `false` | Enable automatic refresh |
| `refreshInterval` | `number` | `60000` | Refresh interval in ms |
| `onFlagsChange` | `function` | - | Callback when flags change |

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  TogglyConfig,
  FeatureFlags,
  ServerFeatureContext,
  TogglyHook,
  HookMetadata,
  FeatureRequirement,
  IdentityContext,
} from '@ops-ai/remix-toggly-core';
```

## Requirements

- Remix 2.0+
- React 18.0+
- Node.js 18.0+

## License

MIT
