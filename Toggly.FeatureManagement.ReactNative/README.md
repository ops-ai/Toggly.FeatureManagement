# Toggly React Native SDK

Lightweight feature flags SDK for React Native and Expo applications, providing powerful feature management with hooks, context providers, and flexible storage options.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Packages

The React Native SDK is modular, allowing you to install only what you need:

| Package | Description |
|---------|-------------|
| `@ops-ai/react-native-toggly` | Main SDK with React hooks and components |
| `@ops-ai/react-native-toggly-core` | Core functionality (automatically installed) |
| `@ops-ai/react-native-toggly-storage-async` | AsyncStorage adapter for persistent caching |
| `@ops-ai/react-native-toggly-storage-mmkv` | MMKV adapter for high-performance storage |

## Installation

### Main SDK (Required)

```bash
npm install @ops-ai/react-native-toggly
# or
yarn add @ops-ai/react-native-toggly
```

### Storage Adapters (Optional)

For persistent feature flag caching, install a storage adapter:

**AsyncStorage (Recommended for Expo):**
```bash
npm install @ops-ai/react-native-toggly-storage-async @react-native-async-storage/async-storage
```

**MMKV (Recommended for bare React Native - faster):**
```bash
npm install @ops-ai/react-native-toggly-storage-mmkv react-native-mmkv
cd ios && pod install
```

### Network State Detection (Optional)

For automatic offline/online handling:

```bash
npm install @react-native-community/netinfo
```

## Quick Start

### Basic Setup with Toggly.io

```tsx
import React from 'react';
import { TogglyProvider, Feature, useFeatureFlag } from '@ops-ai/react-native-toggly';
import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async';

// Create storage adapter for persistent caching
const storage = createAsyncStorageAdapter();

function App() {
  return (
    <TogglyProvider
      appKey="your-app-key"
      environment="production"
      storage={storage}
    >
      <MyApp />
    </TogglyProvider>
  );
}

function MyApp() {
  const { isEnabled, isLoading } = useFeatureFlag('new-dashboard');

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <View>
      <Feature featureKey="welcome-banner">
        <WelcomeBanner />
      </Feature>

      {isEnabled && <NewDashboard />}
    </View>
  );
}
```

### Setup without Toggly.io (Local Feature Flags)

```tsx
import React from 'react';
import { TogglyProvider, Feature } from '@ops-ai/react-native-toggly';

const featureDefaults = {
  'new-dashboard': true,
  'welcome-banner': true,
  'experimental-feature': false,
};

function App() {
  return (
    <TogglyProvider featureDefaults={featureDefaults}>
      <MyApp />
    </TogglyProvider>
  );
}
```

## API Reference

### TogglyProvider

Wraps your app and provides feature flag context to all child components.

```tsx
<TogglyProvider
  // Required (if using Toggly.io)
  appKey="your-app-key"
  environment="production"

  // Optional
  identity="user-123"                    // User identifier for targeted rollouts
  featureDefaults={{ feature1: true }}   // Default values for features
  storage={storageAdapter}               // Storage adapter for caching
  refreshInterval={30000}                // Auto-refresh interval (ms)
  hooks={[analyticsHook]}                // Extensibility hooks

  // Event callbacks
  onReady={() => console.log('Ready')}
  onError={(error) => console.error(error)}
  onFlagsChanged={(flags) => console.log(flags)}
>
  <App />
</TogglyProvider>
```

### Hooks

#### useFeatureFlag

Check a single feature flag status.

```tsx
import { useFeatureFlag } from '@ops-ai/react-native-toggly';

function MyComponent() {
  const { isEnabled, isLoading, error } = useFeatureFlag('feature-key');

  if (isLoading) return <Loading />;
  if (error) return <Error message={error.message} />;

  return isEnabled ? <NewFeature /> : <OldFeature />;
}
```

#### useFeatureGate

Check multiple feature flags with `all` or `any` requirement.

```tsx
import { useFeatureGate } from '@ops-ai/react-native-toggly';

function MyComponent() {
  // All features must be enabled
  const { isEnabled: allEnabled } = useFeatureGate(
    ['feature1', 'feature2'],
    { requirement: 'all' }
  );

  // At least one feature must be enabled
  const { isEnabled: anyEnabled } = useFeatureGate(
    ['feature1', 'feature2'],
    { requirement: 'any' }
  );

  // Negate the result
  const { isEnabled: noneEnabled } = useFeatureGate(
    ['feature1', 'feature2'],
    { requirement: 'all', negate: true }
  );
}
```

#### useToggly

Access the full Toggly service for advanced operations.

```tsx
import { useToggly } from '@ops-ai/react-native-toggly';

function MyComponent() {
  const {
    toggly,           // TogglyService instance
    isReady,          // SDK is initialized
    isLoading,        // Currently loading
    error,            // Initialization error
    isFeatureOn,      // Function to check feature
    setIdentity,      // Set user identity
    refresh,          // Manually refresh flags
    getFeatureValue,  // Get raw feature value
  } = useToggly();

  const handleLogin = async (userId: string) => {
    await setIdentity(userId);
  };

  const handleLogout = async () => {
    await setIdentity(null);
  };

  const handleRefresh = async () => {
    await refresh();
  };
}
```

### Components

#### Feature

Declarative component for conditional rendering based on feature flags.

```tsx
import { Feature } from '@ops-ai/react-native-toggly';

// Single feature
<Feature featureKey="new-feature">
  <NewFeatureContent />
</Feature>

// Multiple features (all required)
<Feature featureKeys={['feature1', 'feature2']}>
  <Content />
</Feature>

// Multiple features (any required)
<Feature featureKeys={['feature1', 'feature2']} requirement="any">
  <Content />
</Feature>

// With negation (show when feature is OFF)
<Feature featureKey="maintenance-mode" negate>
  <NormalContent />
</Feature>

// On + off with negate (preferred over a disabled-branch fallback prop)
<Feature featureKey="premium-feature">
  <PremiumContent />
</Feature>
<Feature featureKey="premium-feature" negate>
  <UpgradePrompt />
</Feature>

// With loading state (not an off-path branch)
<Feature
  featureKey="new-feature"
  loading={<Skeleton />}
>
  <NewFeatureContent />
</Feature>
```

### Storage Adapters

#### AsyncStorage Adapter

Best for Expo and when simplicity is preferred.

```tsx
import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async';

const storage = createAsyncStorageAdapter();

// With custom key prefix
const storage = createAsyncStorageAdapter({ keyPrefix: 'myapp_' });
```

#### MMKV Adapter

Best for performance-critical applications (bare React Native).

```tsx
import { createMMKVStorageAdapter } from '@ops-ai/react-native-toggly-storage-mmkv';
import { MMKV } from 'react-native-mmkv';

// Default instance
const storage = createMMKVStorageAdapter();

// With encryption
const storage = createMMKVStorageAdapter({
  encryptionKey: 'your-secret-key',
});

// With custom MMKV instance
const mmkv = new MMKV({ id: 'toggly-storage' });
const storage = createMMKVStorageAdapter({ mmkv });
```

## User Identity and Targeting

For targeted feature rollouts (A/B testing, gradual rollouts, user segments), provide a user identity:

```tsx
// Set identity at initialization
<TogglyProvider
  appKey="your-app-key"
  environment="production"
  identity="user-123"
>
  <App />
</TogglyProvider>

// Or set/update identity at runtime
function ProfileScreen() {
  const { setIdentity } = useToggly();

  const handleLogin = async (user) => {
    await setIdentity(user.id);
  };

  const handleLogout = async () => {
    await setIdentity(null);
  };
}
```

## Offline Support

The SDK handles offline scenarios gracefully:

1. **Cached values**: When offline, the SDK uses cached feature values from storage
2. **Default values**: If no cache exists, `featureDefaults` are used
3. **Automatic refresh**: When connectivity is restored, flags are automatically refreshed

```tsx
<TogglyProvider
  appKey="your-app-key"
  environment="production"
  storage={createAsyncStorageAdapter()}
  featureDefaults={{
    'critical-feature': true,  // Fallback when offline with no cache
  }}
>
  <App />
</TogglyProvider>
```

## Extensibility with Hooks

Integrate with analytics, monitoring, or implement custom behaviors using hooks.

```tsx
import { Hook } from '@ops-ai/toggly-hooks-types';

const analyticsHook: Hook = {
  getMetadata: () => ({
    name: 'Analytics',
    version: '1.0.0',
  }),

  afterEvaluation: async (data) => {
    analytics.track('Feature Evaluated', {
      feature: data.featureKey,
      enabled: data.result,
      userId: data.userId,
    });
  },

  afterIdentify: async (data) => {
    analytics.identify(data.userId);
  },
};

<TogglyProvider
  appKey="your-app-key"
  environment="production"
  hooks={[analyticsHook]}
>
  <App />
</TogglyProvider>
```

### Available Hook Points

| Hook | Description |
|------|-------------|
| `beforeEvaluation` | Called before feature flag evaluation |
| `afterEvaluation` | Called after evaluation with the result |
| `beforeIdentify` | Called before identity is set/cleared |
| `afterIdentify` | Called after identity is set/cleared |
| `afterRefresh` | Called after flags are refreshed |

## App Lifecycle Handling

The SDK automatically handles app lifecycle:

- **Background**: Pauses refresh interval
- **Foreground**: Resumes and triggers immediate refresh

## TypeScript Support

Full TypeScript support with complete type definitions:

```tsx
import {
  TogglyConfig,
  FeatureFlags,
  TogglyStorage,
  UseFeatureFlagResult,
  UseTogglyResult,
} from '@ops-ai/react-native-toggly';
```

## Examples

### Complete App Example

```tsx
import React from 'react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import {
  TogglyProvider,
  Feature,
  useFeatureFlag,
  useToggly,
} from '@ops-ai/react-native-toggly';
import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async';

const storage = createAsyncStorageAdapter();

export default function App() {
  return (
    <TogglyProvider
      appKey="your-app-key"
      environment="production"
      storage={storage}
      featureDefaults={{
        'welcome-message': true,
        'new-checkout': false,
      }}
      onReady={() => console.log('Toggly ready')}
      onError={(error) => console.error('Toggly error:', error)}
    >
      <MainApp />
    </TogglyProvider>
  );
}

function MainApp() {
  const { isReady, isLoading, error, refresh, setIdentity } = useToggly();

  if (isLoading) {
    return <ActivityIndicator size="large" />;
  }

  if (error) {
    return <Text>Error: {error.message}</Text>;
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Feature featureKey="welcome-message">
        <Text style={{ fontSize: 24 }}>Welcome to our app!</Text>
      </Feature>

      <CheckoutButton />

      <Button title="Login" onPress={() => setIdentity('user-123')} />
      <Button title="Logout" onPress={() => setIdentity(null)} />
      <Button title="Refresh" onPress={refresh} />
    </View>
  );
}

function CheckoutButton() {
  const { isEnabled, isLoading } = useFeatureFlag('new-checkout');

  if (isLoading) return <ActivityIndicator />;

  return isEnabled ? (
    <Button title="New Checkout" onPress={handleNewCheckout} />
  ) : (
    <Button title="Checkout" onPress={handleCheckout} />
  );
}
```

## Expo Compatibility

The SDK is fully compatible with Expo. For storage:

1. Install the AsyncStorage adapter (works with Expo out of the box)
2. If using MMKV, you'll need a development build (not Expo Go)

```bash
# For Expo projects
npx expo install @react-native-async-storage/async-storage
npm install @ops-ai/react-native-toggly-storage-async
```

## Migration from Other SDKs

### From React SDK

The React Native SDK has a similar API to the React SDK:

| React SDK | React Native SDK |
|-----------|------------------|
| `createTogglyProvider` | `TogglyProvider` component |
| `Feature` | `Feature` (same) |
| `useToggly` | `useToggly` (enhanced) |
| - | `useFeatureFlag` (new) |
| - | `useFeatureGate` (new) |

## Troubleshooting

### Features not updating

1. Check that the provider is properly configured
2. Verify network connectivity
3. Try calling `refresh()` manually
4. Check for errors in the `onError` callback

### Storage not working

1. Ensure the storage adapter is installed correctly
2. For MMKV on iOS, run `pod install`
3. Check storage adapter initialization

### TypeScript errors

Ensure you have the correct peer dependencies:

```bash
npm install react react-native
npm install --save-dev @types/react @types/react-native
```

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out the documentation](https://docs.toggly.io/).
