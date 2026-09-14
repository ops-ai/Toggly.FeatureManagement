# @ops-ai/nuxt-toggly

Feature flags for Nuxt 3 and 4 — composables, components, directives, and server utilities

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

Initial groups and claims are forwarded from module version **1.1.2** onward.
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

## Nuxt 3 and 4

Register the same module in `nuxt.config.ts` on both generations. Nuxt 3 uses
`app.vue`; Nuxt 4 uses `app/app.vue` by default. The module registers its own
runtime plugins, components and imports independently of that directory layout.
Keep the Node version required by your Nuxt release: current Nuxt 4.5 requires
Node 22.19+, 24.11+, or 26+. The SDK's Node 18 declaration is retained for older
compatible Nuxt releases; it does not override the host framework's engines.

```vue
<script setup lang="ts">
const { isEnabled } = useFeatureFlag('NewDashboard')
const toggly = useToggly()
</script>

<template>
  <Feature feature-key="NewDashboard"><p>New dashboard</p></Feature>
  <Feature :feature-keys="['NewDashboard', 'Reports']" requirement="any">
    <p>At least one feature is enabled</p>
  </Feature>
  <button @click="toggly.refresh()">Refresh features</button>
</template>
```

Server helpers such as `isEventFeatureOn(event, key)` are auto-imported into
Nitro routes. `autoImport: false`, `globalComponents: false`, and
`globalDirectives: false` retain their existing opt-out behavior.

With `ssr: true` (the default), each render evaluates the shared server's
immutable definitions using that request's context, and provides a separate Vue
instance. Only evaluated booleans and the request identity enter the hydration
payload. The browser applies that snapshot to the core client and Vue state together,
then initializes its remote client after mounting. Public `isFeatureOn` and gate
checks agree with the rendered flags before network initialization. Request context providers registered with
`configureEventEvalContext` also apply to SSR; do not change the shared server
client's identity per request. Groups and claims in request providers affect the
server evaluation only: initialize the browser with its matching context when
its authenticated context differs from the public defaults.

With `ssr: false`, server definition fetching is disabled; Vue SSR receives only
`featureDefaults`. Directives remain browser DOM behaviors; use `<Feature>` for
server-rendered conditional content. Browser identity/features persistence keeps
its existing options and storage keys. Server-created Vue instances are never
exposed through the client package's process-global helper.
