# @ops-ai/toggly-docusaurus-plugin

Docusaurus plugin and React bindings for gating documentation content with Toggly feature flags.

## Installation

```bash
npm install @ops-ai/toggly-docusaurus-plugin @ops-ai/toggly-client-core
# or
pnpm add @ops-ai/toggly-docusaurus-plugin @ops-ai/toggly-client-core
# or
yarn add @ops-ai/toggly-docusaurus-plugin @ops-ai/toggly-client-core
```

## Configuration

Add the plugin to your `docusaurus.config.js` or `docusaurus.config.ts`:

```js
// docusaurus.config.js
module.exports = {
  // ... other config
  plugins: [
    [
      '@ops-ai/toggly-docusaurus-plugin',
      {
        baseURI: 'https://definitions.toggly.io',
        appKey: 'your-app-key',
        environment: 'Production',
        flagDefaults: {
          'beta-feature': false,
        },
        featureFlagsRefreshInterval: 180000, // 3 minutes
        isDebug: false,
        connectTimeout: 5000,
      },
    ],
  ],
};
```

### Plugin Options

- `baseURI` (string, optional): Base URI for the Toggly API (default: `'https://definitions.toggly.io'`). The plugin fetches flags from `${baseURI}/evaluated-signed/${appKey}/${environment}`.
- `appKey` (string, optional): Application key from Toggly
- `environment` (string, optional): Environment name (default: `'Production'`)
- `flagDefaults` (object, optional): Default flag values when API is unavailable
- `featureFlagsRefreshInterval` (number, optional): Refresh interval in milliseconds (default: `180000` = 3 minutes)
- `isDebug` (boolean, optional): Enable debug logging (default: `false`)
- `connectTimeout` (number, optional): Connection timeout in milliseconds (default: `5000`)
- `identity` (string, optional): User identity for targeting

## Page-Level Gating

Add `x-feature` to the frontmatter of any MD/MDX file to gate the entire page:

```markdown
---
id: sso-setup
title: Single Sign-On Setup
x-feature: enterprise_sso
---

This page is only visible when the `enterprise_sso` feature flag is enabled.

The Cloudflare Worker will gate this page according to the `enterprise_sso` flag.
If the feature is off, the page will return a 404 (or redirect, depending on Worker configuration).
```

### How It Works

1. **During Build**: The plugin inspects each doc's metadata and extracts the `x-feature` frontmatter property
2. **Route Mapping**: It creates a mapping from the doc's route path (e.g., `/docs/enterprise/sso-setup`) to the feature key (e.g., `enterprise_sso`)
3. **Manifest Generation**: At the end of the build, it emits a JSON file at `${outDir}/toggly-page-features.json` in the build output directory
4. **Edge Enforcement**: The Cloudflare Worker reads this manifest and enforces gating at the edge

### Generated Manifest

The plugin automatically generates a JSON manifest in your build output directory:

**Location**: `build/toggly-page-features.json` (or `${outDir}/toggly-page-features.json`)

**Example content**:
```json
{
  "/docs/enterprise/sso-setup": "enterprise_sso",
  "/docs/advanced/filters": "beta_advanced_filters"
}
```

This manifest is consumed by the Cloudflare Worker to determine which pages should be gated and which feature flag to check for each route.

## React Components and Hooks

### Setup TogglyProvider

Wrap your Docusaurus app with `TogglyProvider`. You can do this by swizzling the root layout:

```bash
npm run swizzle @docusaurus/theme-classic Root -- --wrap
```

Then modify `src/theme/Root/index.js`:

```jsx
import React from 'react';
import Root from '@theme/Root';
import { TogglyProvider } from '@ops-ai/toggly-docusaurus-plugin/client';

export default function RootWrapper({ children }) {
  // Config is automatically injected by the plugin
  const config = typeof window !== 'undefined' ? window.__TOGGLY_CONFIG__ : {};
  
  return (
    <TogglyProvider config={config}>
      <Root>{children}</Root>
    </TogglyProvider>
  );
}
```

### Using the Feature Component

```tsx
import { Feature } from '@ops-ai/toggly-docusaurus-plugin/client';

function MyComponent() {
  return (
    <div>
      <h1>Public Content</h1>
      
      <Feature flag="beta_advanced_filters">

        <h2>Advanced Filters (Beta)</h2>
        <p>This feature is in beta...</p>
      </Feature>
    </div>
  );
}
```

### Using the useFlag Hook

```tsx
import { useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';

function MyComponent() {
  const { enabled, isReady } = useFlag('beta_advanced_filters', false);
  
  if (!isReady) {
    return <div>Loading...</div>;
  }
  
  return enabled ? (
    <div>Beta feature is enabled!</div>
  ) : (
    <div>Beta feature is disabled</div>
  );
}
```

### Using the useToggly Hook

```tsx
import { useToggly } from '@ops-ai/toggly-docusaurus-plugin/client';

function MyComponent() {
  const { flags, isReady, getFlag } = useToggly();
  
  const handleClick = async () => {
    const isEnabled = await getFlag('my-feature', false);
    console.log('Feature enabled:', isEnabled);
  };
  
  return (
    <button onClick={handleClick} disabled={!isReady}>
      Check Feature
    </button>
  );
}
```

## Edge / Hydration Contract

When the companion `@ops-ai/toggly-cloudflare-worker` is in front of the site, the worker streams the static HTML through `HTMLRewriter`, removes `[data-feature]` elements whose flag is disabled, and **injects a `<script>` near the top of `<head>` that pins the resolved flag map onto `window.__TOGGLY_EDGE_FLAGS__`**.

`TogglyProvider` reads that snapshot synchronously via `readEdgeFlagsSnapshot()` and seeds its initial `flags` / `isReady` state from it, so the very first client render evaluates `Feature` components against the same flag values the edge used. That keeps the React tree aligned with the post-strip DOM and lets React 18 hydrate without a recoverable error / full-root re-render.

When no edge worker is deployed (no snapshot present), the provider stays `isReady=false` until the client SDK fetches flags, and `Feature` components keep their wrapper during that window so the React tree matches the untransformed origin HTML. Once flags resolve, normal re-renders apply — that is post-hydration and not a mismatch.

You don't need to do anything to opt in: as long as the worker is wired up, hydration is consistent.

## Section-Level Gating

For section-level gating, you can use the `data-feature` attribute with a client-side script or component:

```tsx
import { useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';

function FeatureSection({ flag, children }) {
  const { enabled, isReady } = useFlag(flag);
  
  if (!isReady || !enabled) {
    return null;
  }
  
  return <div data-feature={flag}>{children}</div>;
}
```

Or in MDX:

```mdx
import { Feature } from '@ops-ai/toggly-docusaurus-plugin/client';

<Feature flag="beta_advanced_filters">
  <div data-feature="beta_advanced_filters">
    <h2>Advanced Filters (Beta)</h2>
    <p>This section is gated by the feature flag.</p>
  </div>
</Feature>
```

## Generated Files

The plugin generates:

- `build/toggly-page-features.json` (or `${outDir}/toggly-page-features.json`): A mapping of route paths to feature flag keys, used by the Cloudflare Worker for edge enforcement

This file is generated during the Docusaurus build process and is placed in the build output directory, making it accessible to the Cloudflare Worker at the root of your deployed site.

## TypeScript Support

Full TypeScript support is included. Import types as needed:

```tsx
import type {
  TogglyProviderProps,
  TogglyContextValue,
  FeatureProps,
} from '@toggly/docusaurus-plugin/client';
```

## License

MIT
