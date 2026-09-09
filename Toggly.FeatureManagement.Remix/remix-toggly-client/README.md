# @ops-ai/remix-toggly-client

Client-side React components and hooks for Toggly feature flags in Remix

## Install

```bash
npm install @ops-ai/remix-toggly-client
```

## Initial evaluation context

Requires client **1.4.0** and core **1.8.0** (release pending). This API is
not available in the currently published client 1.3.0.

```tsx
import { TogglyProvider } from '@ops-ai/remix-toggly-client';

// Supply context before mounting so the first request is already targeted.
const config = {
  appKey: 'your-app-key',
  environment: 'Production',
  identity: 'user-123', // Your stable user identifier.
  groups: ['beta-testers'], // Memberships used by targeting rules.
  claims: { plan: 'pro' }, // Attributes used by targeting rules.
};

export default function App() {
  return <TogglyProvider config={config}><YourApp /></TogglyProvider>;
}
```

Replace `YourApp` with your application component. Set identity, groups, and
claims from the current browser user's known context. This avoids an anonymous
initial request followed by a second request from `identify()`.

When `serverContext` is supplied, its identity and flags hydrate the provider
without an initial browser fetch. A missing or empty server identity remains
anonymous, even if configuration names a user; the snapshot is never relabeled
as that user. Configured identity seeds startup only when `serverContext` is
absent. `refresh()` retains the active
identity; `reset()` clears identity and fetches anonymously (configured groups
and claims remain). Omitted identity preserves anonymous startup; an empty
identity remains empty and is not sent in the URL. Server evaluation should
continue to use request-local context, never another user's process-wide identity.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
