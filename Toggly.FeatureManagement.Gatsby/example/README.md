# Toggly Gatsby Example

This is an example Gatsby site demonstrating the `@ops-ai/gatsby-feature-flags-toggly` plugin.

## Setup

### Prerequisites

The example app uses the parent SDK package via `file:../` dependency. Before running the example, ensure the SDK is built:

```bash
# From the SDK root directory (one level up)
cd ..
npm install
npm run build
```

### Running the Example

1. Install example dependencies:

```bash
npm install
```

2. Set your Toggly app key (optional, uses demo defaults):

```bash
export TOGGLY_APP_KEY=your-app-key
export TOGGLY_ENVIRONMENT=Production
```

3. Run the development server:

```bash
npm run dev
```

4. Open [http://localhost:8000](http://localhost:8000)

### Troubleshooting

If you see "Failed to resolve @ops-ai/gatsby-feature-flags-toggly":
1. Make sure the parent SDK is built (`cd .. && npm run build`)
2. Delete node_modules and reinstall: `rm -rf node_modules && npm install`
3. Try cleaning Gatsby cache: `npm run clean && npm run dev`

## Features Demonstrated

### 1. Home Page (`/`)

- **useFeatureFlag Hook**: Demonstrates checking a single flag
- **Feature Component**: Shows conditional rendering with fallback

### 2. Features Page (`/features`)

- **useFeatureFlag Hook**: Check single flags
- **useFeatureGate Hook**: Check multiple flags with gate logic
- **FeatureGate Component**: Conditional rendering with multiple flags
- **useToggly Hook**: Access all flags and utilities (refresh, identity)

### 3. Beta Page (`/beta.mdx`)

- **Page-Level Gating**: Demonstrates frontmatter-based feature requirements
- Shows how `x-feature` in frontmatter creates manifest entries

## Build and Deploy

1. Build the site:

```bash
npm run build
```

2. Check generated manifests in `public/`:
   - `toggly-page-features.json` - Page-to-feature mapping
   - `toggly-config.json` - Sanitized config for edge workers

3. Serve the built site:

```bash
npm run serve
```

4. Open [http://localhost:9000](http://localhost:9000)

## Configuration

The plugin is configured in `gatsby-config.js`:

```javascript
{
  resolve: '@ops-ai/gatsby-feature-flags-toggly',
  options: {
    appKey: 'your-app-key',
    environment: 'Production',
    allFeaturesEnabledDuringBuild: true,
    flagDefaults: {
      'new-dashboard': false,
      'beta-feature': false,
      'premium-content': false,
      'experimental-ui': false,
    },
    isDebug: true,
  },
}
```

## Feature Flags Used

- `new-dashboard` - Demonstrates simple flag check
- `beta-feature` - Used for page-level gating
- `premium-content` - Shows premium content gating
- `experimental-ui` - Part of multi-flag gate demonstration

## Learning Resources

- [Plugin Documentation](../README.md)
- [Toggly Dashboard](https://app.toggly.io)
- [Gatsby Documentation](https://www.gatsbyjs.com/docs/)
