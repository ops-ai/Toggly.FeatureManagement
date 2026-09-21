# @ops-ai/toggly-docusaurus-plugin

## Initial browser targeting context

Available since **0.9.0**.

```tsx
import { TogglyProvider } from '@ops-ai/toggly-docusaurus-plugin/client';

<TogglyProvider config={{
  appKey: 'your-app-key',
  identity: 'user-123', // Stable identifier for this browser user.
  groups: ['beta'], // Memberships used by targeting rules.
  claims: { plan: 'pro' }, // String attributes used by targeting rules.
}}>
  <App />
</TogglyProvider>
```

Supply context when the provider is first mounted so the first evaluated request
already targets that user. The client copies groups and claims; changing serialized
provider configuration replaces its owner and cache. Up to
20 nonempty claims are sent in deterministic key order; group whitespace is trimmed.

The same `identity`, `groups`, and `claims` options may be supplied in the
`@ops-ai/toggly-docusaurus-plugin` entry in `docusaurus.config.js`. Those values
are **public build-time defaults baked into the browser bundle**, not authenticated
per-user data or secrets. They do not change static build-time gating or edge
worker evaluation. Use the provider configuration for browser-user targeting.


Docusaurus plugin and React bindings for gating documentation content with Toggly feature flags.

## Installation

```bash
npm install @ops-ai/toggly-docusaurus-plugin
# or
pnpm add @ops-ai/toggly-docusaurus-plugin
# or
yarn add @ops-ai/toggly-docusaurus-plugin
```

The plugin bundles its own flag client. You do not need `@ops-ai/toggly-client-core`.

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
- `enableTelemetry` (boolean, optional): Enable browser telemetry (default: `true` with a public application key)
- `metricsBaseUrl` (string, optional): Independent metrics base URL (default: `https://metrics.toggly.io`)
- `telemetryFlushIntervalMs` (number, optional): Base flush interval, 30000–60000 milliseconds (default: 45000), with scheduling jitter

## Browser telemetry

Each provider owns one reporter shared by its hooks and components. Direct `getFlag` calls and actual committed UI evaluations record checks using `enabled` or `disabled`; repeated unchanged hook snapshots, internal refreshes and hydration projection are silent. Negation changes the rendered branch after the underlying check is counted. Navbar gating uses a separate short-lived client and records only mapped links it evaluates.

```tsx
const toggly = useToggly();
toggly.recordUsage('Checkout', 'control');
toggly.recordView('Checkout', 'control');
toggly.incrementCounter('orders', 2);
toggly.setGauge('cartItems', 3);
await toggly.flushTelemetry();
```

Usage and view are explicit events; rendering never implies either. Explicit variants use 1–64 ASCII letters, digits, underscores or hyphens. Counters accept nonnegative integer deltas and gauges finite nonnegative values. Metric names refer to configured application-level metrics. Telemetry contains application/environment and aggregate counts/values; it excludes identity, groups, claims, entity data and timestamps and is never persisted.

`metricsBaseUrl` is independent of the definitions endpoint and preserves an explicit base path. Invalid telemetry intervals use the default; invalid telemetry URLs disable reporting without affecting feature evaluation. Provider config can supply `telemetryFetch` and `onTelemetryDiagnostic` for independent transport and bounded payload-free diagnostics. Changing function callbacks alone does not replace a running provider; remount it to apply those changes.

Queues and retries are bounded and delivery is best effort. Ordinary browser flushes prefer native gzip; pagehide/hidden and final teardown use plain fetch keepalive. Provider cleanup retires its client after a microtask so React StrictMode can replay effects safely. Use `flushTelemetry()` before removing an owner when you need to await a send attempt. Different providers retain independent queues, and changed application/environment configuration never relabels old events.

With `staticGating: true`, flags remain baked into the build: no runtime definitions requests or WebSockets are opened. Actual browser evaluations still report telemetry when a public browser app key is configured. Set `enableTelemetry: false` for a fully silent static runtime. Build-only keys are not added to browser configuration to enable reporting. Replacing a provider configuration retires its owner; in static mode the replacement uses its own `flagDefaults` rather than reusing the original application’s baked map. Rebuild to bake a different application’s flags. SSR and builds never create frontend telemetry, and trusted edge enforcement remains separate.

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

      {/* Off path — same pattern as .NET <feature negate> */}
      <Feature flag="beta_advanced_filters" negate>
        <p>Stable filters (beta off).</p>
      </Feature>
    </div>
  );
}
```

With an edge worker in front, SSR emits `data-feature` wrappers. Positive matches are stripped when the flag is off; wrappers with `data-toggly-negate="true"` stay in the HTML so the client can hydrate the off path without a mismatch.

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

When the companion `@ops-ai/toggly-cloudflare-worker` is in front of the site, the worker streams the static HTML through `HTMLRewriter`, removes `[data-feature]` elements whose flag is disabled (**except** elements marked `data-toggly-negate="true"`, which hydrate client-side), and **injects a `<script>` near the top of `<head>` that pins the resolved flag map onto `window.__TOGGLY_EDGE_FLAGS__`**.

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
