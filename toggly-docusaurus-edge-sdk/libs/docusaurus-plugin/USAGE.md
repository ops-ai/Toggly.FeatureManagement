# Using @ops-ai/toggly-docusaurus-plugin

This guide explains how to integrate Toggly feature flags into your Docusaurus site using the `@ops-ai/toggly-docusaurus-plugin`.

## Installation

```bash
npm install @ops-ai/toggly-docusaurus-plugin @ops-ai/toggly-client-core
# or
yarn add @ops-ai/toggly-docusaurus-plugin @ops-ai/toggly-client-core
# or
pnpm add @ops-ai/toggly-docusaurus-plugin @ops-ai/toggly-client-core
```

## Configuration

Add the plugin to your `docusaurus.config.js` (or `.ts`):

```javascript
// docusaurus.config.js
module.exports = {
  // ...
  plugins: [
    [
      '@ops-ai/toggly-docusaurus-plugin',
      {
        // Required: Your Toggly API details
        baseURI: 'https://definitions.toggly.io',
        appKey: 'YOUR_APP_KEY',
        environment: 'Production',
        
        // Optional: Default flag values (fallback)
        flagDefaults: {
          'beta-feature': false,
          'new-docs': true
        },
        
        // Optional: Debug mode
        isDebug: false,
      },
    ],
  ],
};
```

## Root Layout Setup

To make feature flags available throughout your app, you need to wrap your site with the `TogglyProvider`. The easiest way is to swizzle the Root component.

1. **Swizzle the Root component:**

```bash
npm run swizzle @docusaurus/theme-classic Root -- --wrap
```

2. **Update `src/theme/Root/index.js`:**

```javascript
import React from 'react';
import Root from '@theme/Root';
import { TogglyProvider } from '@ops-ai/toggly-docusaurus-plugin/client';

export default function RootWrapper({ children }) {
  // The plugin injects configuration into window.__TOGGLY_CONFIG__
  const config = typeof window !== 'undefined' ? window.__TOGGLY_CONFIG__ : {};
  
  return (
    <TogglyProvider config={config}>
      <Root>{children}</Root>
    </TogglyProvider>
  );
}
```

## Usage in Documentation (MDX)

### Gating Entire Pages

Add the `x-feature` frontmatter to any Markdown file to gate the entire page. This works in conjunction with the Cloudflare Worker to provide 404s for disabled features.

```markdown
---
id: advanced-analytics
title: Advanced Analytics
x-feature: enterprise_analytics
---

# Advanced Analytics

This content is only available if the `enterprise_analytics` feature is enabled.
```

### Gating Sections with `<Feature>` Component

Use the `<Feature>` component to conditionally render content within a page.

```jsx
import { Feature } from '@ops-ai/toggly-docusaurus-plugin/client';

# Dashboard

Here is the standard dashboard.

<Feature flag="beta_widgets" fallback={<p>New widgets coming soon!</p>}>
  ## Beta Widgets
  
  This section is only visible to users with the `beta_widgets` flag enabled.
  
  ![Widget Screenshot](./img/widget.png)
</Feature>
```

### Gating via DOM Attributes

For content that needs to be scrubbed by the Cloudflare Worker but rendered normally in development, use the `data-feature` attribute.

```html
<div data-feature="experimental_api">
  <h2>Experimental API</h2>
  <p>This section will be removed from the HTML by the edge worker if the flag is off.</p>
</div>
```

You can combine this with the `<Feature>` component for the best of both worlds (client-side reactivity + edge-side security):

```jsx
<Feature flag="experimental_api">
  <div data-feature="experimental_api">
    <h2>Experimental API</h2>
    <p>Securely gated content.</p>
  </div>
</Feature>
```

## Usage in React Components

You can use hooks to access feature flags in your custom React components.

### `useFlag` Hook

The simplest way to check a single flag.

```tsx
import React from 'react';
import { useFlag } from '@ops-ai/toggly-docusaurus-plugin/client';

export function ActionButton() {
  const { enabled, isReady } = useFlag('new_action_button', false);

  if (!isReady) return null;

  if (!enabled) return null;

  return <button>New Action</button>;
}
```

### `useToggly` Hook

Access the full Toggly client context.

```tsx
import React from 'react';
import { useToggly } from '@ops-ai/toggly-docusaurus-plugin/client';

export function FeatureList() {
  const { flags, isReady } = useToggly();

  if (!isReady) return <div>Loading flags...</div>;

  return (
    <ul>
      {Object.entries(flags).map(([key, enabled]) => (
        <li key={key}>{key}: {enabled ? 'On' : 'Off'}</li>
      ))}
    </ul>
  );
}
```

## Build Artifacts

When you build your Docusaurus site (`npm run build`), the plugin generates a manifest file at:

`build/toggly-page-features.json`

This file contains a mapping of all gated routes:

```json
{
  "/docs/advanced-analytics": "enterprise_analytics",
  "/docs/beta/new-feature": "beta_feature"
}
```

The Cloudflare Worker uses this manifest to enforce page-level gating at the edge.
