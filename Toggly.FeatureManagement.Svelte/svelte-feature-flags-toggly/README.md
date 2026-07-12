Lightweight package that provides feature flags support for Svelte applications allowing you to check feature status and enable/disable them easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://www.npmjs.com/package/@ops-ai/svelte-feature-flags-toggly"><img src="https://img.shields.io/npm/v/@ops-ai/svelte-feature-flags-toggly.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

Simply install using NPM to install this package.

```shell
$ npm i -s @ops-ai/svelte-feature-flags-toggly
```

## Basic Usage (with Toggly.io)

### Initialize Toggly

Import and initialize Toggly in your main application file (typically `App.svelte` or `main.ts`):

```typescript
import { createToggly } from '@ops-ai/svelte-feature-flags-toggly'

// Initialize with your App Key & Environment name from your Toggly application page
await createToggly({
  appKey: 'your-app-key', // You can find this in app.toggly.io
  environment: 'your-environment-name', // You can find this in app.toggly.io
})
```

### Using the Feature Component

Now you can start using the Feature component anywhere in your application:

```svelte
<script>
  import { Feature } from '@ops-ai/svelte-feature-flags-toggly'
</script>

<Feature featureKey="firstFeature">
  <p>This feature can be turned on or off.</p>
</Feature>
```

### Feature Component Options

You can also check multiple feature keys and make use of the *requirement* (all/any) and *negate* (bool) options (requirement is set to "all" by default).

#### Show if all features are on

```svelte
<Feature featureKeys={['firstFeature', 'secondFeature']}>
  <p>ALL the provided feature keys are TRUE.</p>
</Feature>
```

#### Show if any feature is on

```svelte
<Feature featureKeys={['firstFeature', 'secondFeature']} requirement="any">
  <p>AT LEAST ONE the provided feature keys is TRUE.</p>
</Feature>
```

#### Show if features are off (negate)

```svelte
<Feature featureKeys={['firstFeature', 'secondFeature']} negate={true}>
  <p>NONE of the provided feature keys is TRUE.</p>
</Feature>
```

### Programmatic Feature Checks

You can also check features programmatically using the store functions:

```svelte
<script>
  import { isFeatureOn, isFeatureOff, evaluateFeatureGate } from '@ops-ai/svelte-feature-flags-toggly'
  
  let featureEnabled = false
  
  async function checkFeature() {
    featureEnabled = await isFeatureOn('myFeature')
  }
  
  async function checkMultipleFeatures() {
    const result = await evaluateFeatureGate(['feature1', 'feature2'], 'any', false)
    console.log('Gate result:', result)
  }
</script>

<button on:click={checkFeature}>Check Feature</button>
{#if featureEnabled}
  <p>Feature is enabled!</p>
{/if}
```

### Using Reactive Stores

You can also use Svelte stores for reactive feature flag checks:

```svelte
<script>
  import { createFeatureStore } from '@ops-ai/svelte-feature-flags-toggly'
  
  const myFeature = createFeatureStore('myFeature')
</script>

{#if $myFeature}
  <p>Feature is enabled!</p>
{/if}
```

## Users and Rollouts

Using this package with [Toggly](https://toggly.io) allows you to define custom feature rollouts.

Custom rollouts offers the ability to show features only to certain groups of users based on various custom rules which you can define in [Toggly](https://app.toggly.io).

In case you want to support custom feature rollouts, remember to provide an unique identity string for each user to make sure they get the same feature values on future visits:

```typescript
await createToggly({
  appKey: 'your-app-key', // You can find this in app.toggly.io
  environment: 'your-environment-name', // You can find this in app.toggly.io
  identity: 'unique-user-identifier', // Use this in case you want to support custom feature rollouts
})
```

## Basic Usage (without Toggly.io)

You can also use the Svelte SDK without connecting to Toggly.io by providing feature defaults:

### Initialize with Defaults

```typescript
import { createToggly } from '@ops-ai/svelte-feature-flags-toggly'

const featureDefaults = {
  firstFeature: true,
  secondFeature: false,
}

await createToggly({
  featureDefaults: featureDefaults,
})
```

Now you can use the Feature component the same way as with Toggly.io:

```svelte
<Feature featureKey="firstFeature">
  <p>This feature can be turned on or off.</p>
</Feature>
```

## Configuration Options

The `createToggly` function accepts the following options:

```typescript
interface TogglyOptions {
  baseURI?: string                    // Base URI for Toggly API (default: 'https://client.toggly.io')
  appKey?: string                      // Your Toggly app key
  environment?: string                  // Environment name (default: 'Production')
  identity?: string                     // User identity for targeting
  featureDefaults?: { [key: string]: boolean }  // Default feature values
  showFeatureDuringEvaluation?: boolean // Show feature while evaluating (default: false)
  featureFlagsRefreshInterval?: number // Cache refresh interval in ms (default: 180000)
}
```

## TypeScript Support

The Svelte SDK includes full TypeScript support with type definitions:

```typescript
import { 
  Feature, 
  createToggly, 
  isFeatureOn,
  type TogglyOptions 
} from '@ops-ai/svelte-feature-flags-toggly'

const config: TogglyOptions = {
  appKey: 'your-app-key',
  environment: 'Production',
  identity: 'user-123'
}

await createToggly(config)
```

## SvelteKit Integration

For SvelteKit applications, initialize Toggly in your root layout or a client-side component:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { onMount } from 'svelte'
  import { createToggly } from '@ops-ai/svelte-feature-flags-toggly'
  
  onMount(async () => {
    await createToggly({
      appKey: 'your-app-key',
      environment: 'Production',
      identity: 'user-123' // Get from session/auth
    })
  })
</script>

<slot />
```

## Best Practices

1. **Initialize Once**: Call `createToggly()` once at the root of your app
2. **Use Feature Component**: Prefer using the Feature component for declarative feature flag checks
3. **Provide User Context**: Include identity for accurate targeting and rollouts
4. **Set Feature Defaults**: Provide defaults for offline scenarios or when not using Toggly.io
5. **TypeScript**: Take advantage of TypeScript support for better type safety
6. **Reactive Stores**: Use `createFeatureStore()` for reactive feature flag checks in your components

## API Reference

### `createToggly(config: TogglyOptions): Promise<void>`

Initializes the Toggly service and loads feature flags.

### `<Feature>`

Svelte component for conditional rendering based on feature flags.

**Props:**
- `featureKey?: string` - Single feature key to check
- `featureKeys?: string[]` - Multiple feature keys to check
- `requirement?: 'all' | 'any'` - Requirement type (default: 'all')
- `negate?: boolean` - Whether to negate the result (default: false)

### `isFeatureOn(featureKey: string): Promise<boolean>`

Check if a feature is enabled.

### `isFeatureOff(featureKey: string): Promise<boolean>`

Check if a feature is disabled.

### `evaluateFeatureGate(featureKeys: string[], requirement?: 'all' | 'any', negate?: boolean): Promise<boolean>`

Evaluate a feature gate with multiple flags.

### `createFeatureStore(featureKey: string)`

Create a reactive Svelte store for a specific feature flag.

## Building the Library

If you're contributing to or building this library from source:

### Prerequisites

- Node.js 18+ and npm
- All dependencies installed

### Build Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run type checking:**
   ```bash
   npm run typecheck
   ```

3. **Build the library:**
   ```bash
   npm run build
   ```

   This will:
   - Compile TypeScript to JavaScript
   - Bundle the library for both ESM and CommonJS formats
   - Generate TypeScript declaration files
   - Output files to the `dist/` directory

4. **Verify the build:**
   ```bash
   ls -la dist/
   ```

   You should see:
   - `svelte-feature-flags-toggly.es.js` - ES Module build
   - `svelte-feature-flags-toggly.cjs` - CommonJS build
   - `index.js` - Svelte component entry point
   - `types/` - TypeScript declaration files

### Testing the Build Locally

You can test the built package locally using npm link:

1. **Link the package:**
   ```bash
   npm link
   ```

2. **In your test project:**
   ```bash
   npm link @ops-ai/svelte-feature-flags-toggly
   ```

3. **Or test with the example app:**
   ```bash
   cd example
   npm install
   npm run dev
   ```

## Publishing to npm

### Prerequisites for Publishing

1. **npm account**: You need an npm account with access to the `@ops-ai` organization
2. **Authentication**: You must be logged in to npm:
   ```bash
   npm login
   ```

3. **Organization access**: Ensure you have publish permissions for `@ops-ai` scope

### Publishing Steps

1. **Update version number:**
   
   Update the version in `package.json` following [Semantic Versioning](https://semver.org/):
   - **Patch** (1.0.0 → 1.0.1): Bug fixes
   - **Minor** (1.0.0 → 1.1.0): New features (backward compatible)
   - **Major** (1.0.0 → 2.0.0): Breaking changes

   ```bash
   # Or use npm version command
   npm version patch  # for 1.0.0 → 1.0.1
   npm version minor  # for 1.0.0 → 1.1.0
   npm version major  # for 1.0.0 → 2.0.0
   ```

2. **Update CHANGELOG.md:**
   
   Document the changes in `CHANGELOG.md` with the new version number and date.

3. **Build the library:**
   ```bash
   npm run build
   ```

4. **Verify the build output:**
   ```bash
   # Check that dist/ contains all necessary files
   ls -la dist/
   ```

5. **Dry run (optional but recommended):**
   ```bash
   npm publish --dry-run
   ```
   
   This shows what would be published without actually publishing.

6. **Publish to npm:**
   ```bash
   npm publish --access public
   ```
   
   The `--access public` flag is required for scoped packages (`@ops-ai/...`) to be published publicly.

### Publishing Checklist

Before publishing, ensure:

- [ ] Version number is updated in `package.json`
- [ ] `CHANGELOG.md` is updated with new version
- [ ] All tests pass (if applicable)
- [ ] Build completes successfully
- [ ] `dist/` directory contains all expected files
- [ ] TypeScript declarations are generated correctly
- [ ] README.md is up to date
- [ ] License file is present
- [ ] `.npmignore` excludes source files and examples

### Post-Publishing

After successful publication:

1. **Create a git tag:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Verify on npm:**
   Visit `https://www.npmjs.com/package/@ops-ai/svelte-feature-flags-toggly` to confirm the new version is available.

3. **Update documentation:**
   If this is a major release or includes breaking changes, update the main Toggly documentation.

### Troubleshooting

**Error: "You do not have permission to publish"**
- Ensure you're logged in: `npm whoami`
- Verify you have access to the `@ops-ai` organization
- Contact the organization admin for access

**Error: "Package name already exists"**
- Check if the version already exists on npm
- Increment the version number

**Build fails:**
- Ensure all dependencies are installed: `npm install`
- Check TypeScript errors: `npm run typecheck`
- Verify `vite.config.ts` is correctly configured

## Device-local post-filter gates

Gate bundles of flags behind device-local master switches while rollouts stay on the worker. See **[Post-filter gates](https://docs.toggly.io/sdks/client-side/post-filter)**.

```typescript
import { createToggly, type LocalGate } from '@ops-ai/svelte-feature-flags-toggly';

let apiRedesignEnabled = false;

await createToggly({
  appKey: 'your-app-key',
  localGates: [{
    id: 'apiRedesign',
    flagKeys: ['ApiV2Checkout'],
    isEnabled: () => apiRedesignEnabled,
  } satisfies LocalGate],
});

import { getTogglyService } from '@ops-ai/svelte-feature-flags-toggly';

const toggly = getTogglyService();
apiRedesignEnabled = false;
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

**During plugin initialization:**

```typescript
import { initializeToggly } from '@ops-ai/svelte-feature-flags-toggly';

initializeToggly({
  appKey: 'your-app-key',
  environment: 'your-environment-name',
  hooks: [myAnalyticsHook]
});
```

**At runtime:**

```typescript
import { togglyService } from '@ops-ai/svelte-feature-flags-toggly';

// Add a hook
togglyService.addHook(myAnalyticsHook);

// Remove a hook
togglyService.removeHook(myAnalyticsHook);
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

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
