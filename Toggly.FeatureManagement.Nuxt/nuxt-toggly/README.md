# @ops-ai/nuxt-toggly

Feature flags for Nuxt 3 - composables, components, directives, and server utilities

## Install

```bash
npm install @ops-ai/nuxt-toggly
```

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).

## Initial targeting context

Requires module **1.1.2 (release pending)**; published 1.1.1 drops module groups and claims.
Supply known context before initialization to avoid fetching once anonymously and again
after setting targeting. Module options are public application defaults, visible to
the browser. Do not put secrets or request-specific authenticated user data here.

```ts
// nuxt.config.ts — public defaults for a demo application
export default defineNuxtConfig({
  modules: ['@ops-ai/nuxt-toggly'],
  toggly: {
    appKey: 'your-app-key',
    environment: 'Production',
    identity: 'demo-user', // Stable identifier for this demo user.
    groups: ['beta'], // Membership used by targeting rules.
    claims: { plan: 'pro' }, // String attributes used by targeting rules.
    persistFeatures: false, // Avoid hydrating an old user's persisted flags.
  },
})
```

For authenticated applications, use request-local server evaluation context and a
client instance initialized with the signed-in user's known context. Never rebind
the shared server client for each incoming request. Empty groups (`[]`) and claims
(`{}`) are forwarded unchanged. Existing persisted feature snapshots are not scoped
to targeting context; this module fix does not change that cache behavior.
