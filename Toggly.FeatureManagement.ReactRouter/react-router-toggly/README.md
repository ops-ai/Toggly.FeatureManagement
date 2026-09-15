# @ops-ai/react-router-toggly

Toggly feature flags for **React Router 7/8 framework mode**. One package with
`./client` and `./server` entry points. Core evaluation and telemetry live
in-source (not published as a separate package).

> Migrating from `@ops-ai/remix-toggly-*`? Those packages are deprecated. Install
> `@ops-ai/react-router-toggly` and import from `/client` and `/server`.

## Install

```bash
npm install @ops-ai/react-router-toggly react-router react react-dom
```

Peers: `react-router ^7 || ^8`, `react` / `react-dom ^18 || ^19`. Optional:
`@react-router/node`. Requires Node `>=18`.

## Quick start

### Server loader

```ts
// app/toggly.server.ts
import { createTogglyLoader } from '@ops-ai/react-router-toggly/server';

export const toggly = createTogglyLoader({
  appKey: process.env.TOGGLY_APP_KEY!,
  environment: process.env.TOGGLY_ENVIRONMENT ?? 'Production',
  getIdentity: async (request) => {
    // Resolve session identity for this request
    return null;
  },
});
```

```tsx
// app/root.tsx
import { Outlet } from 'react-router';
import { RouterTogglyProvider } from '@ops-ai/react-router-toggly/client';
import { toggly } from './toggly.server';

export async function loader(args: { request: Request }) {
  return toggly.getLoaderData(args);
}

export default function App() {
  return (
    <RouterTogglyProvider routeId="root">
      <Outlet />
    </RouterTogglyProvider>
  );
}
```

### Client gates

```tsx
import { Feature, useFeature } from '@ops-ai/react-router-toggly/client';

export default function Home() {
  const beta = useFeature('Beta');
  return (
    <Feature feature="Checkout">
      <Checkout />
      {beta ? <BetaBanner /> : null}
    </Feature>
  );
}
```

### Feature-gated actions

```ts
import { createFeatureGatedAction } from '@ops-ai/react-router-toggly/server';

export const action = createFeatureGatedAction(
  {
    appKey: process.env.TOGGLY_APP_KEY!,
    requiredFeatures: 'AdminTools',
  },
  async () => ({ ok: true }),
);
```

## Exports

| Subpath | Purpose |
|---------|---------|
| `@ops-ai/react-router-toggly/client` | `RouterTogglyProvider`, hooks, `Feature` components |
| `@ops-ai/react-router-toggly/server` | Loaders, actions, `TogglyServerClient` |

Server-only modules (`ws`, gRPC telemetry) must not be imported from client code.

## Development

```bash
npm install
npm run build
npm test
npm run test:coverage
npm run test:hosts   # packed RR7/RR8 hosts (needs matching Node majors)
```

## License

MIT
