# Toggly Svelte Example

This is an example application demonstrating how to use `@ops-ai/svelte-feature-flags-toggly` in a Svelte application.

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Update the Toggly configuration in `src/App.svelte`:
   - Replace `'your-app-key'` with your actual Toggly app key
   - Replace `'Production'` with your environment name
   - Or use `featureDefaults` for offline testing

3. Run the development server:
```bash
npm run dev
```

4. Open your browser to `http://localhost:5173`

## Features Demonstrated

- Feature component with single feature key
- Feature component with multiple feature keys
- Feature component with `all` and `any` requirements
- Feature component with negation
- Programmatic feature checks using `isFeatureOn()` and `isFeatureOff()`
- Feature gate evaluation
- Reactive stores for feature flags

## Learn More

- [Toggly Documentation](https://docs.toggly.io)
- [Svelte Documentation](https://svelte.dev)
