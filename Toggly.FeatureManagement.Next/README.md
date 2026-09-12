# Toggly Next.js SDKs

Official Next.js packages for [Toggly](https://toggly.io) feature flags (client, server, edge, and shared core).

## Packages

| Package | Path |
|---------|------|
| `@ops-ai/nextjs-toggly-core` | [`nextjs-toggly-core`](nextjs-toggly-core) |
| `@ops-ai/nextjs-toggly-client` | [`nextjs-toggly-client`](nextjs-toggly-client) |
| `@ops-ai/nextjs-toggly-server` | [`nextjs-toggly-server`](nextjs-toggly-server) |
| `@ops-ai/nextjs-toggly-edge` | [`nextjs-toggly-edge`](nextjs-toggly-edge) |

## Install

```bash
npm install @ops-ai/nextjs-toggly-core @ops-ai/nextjs-toggly-client
# add server / edge packages as needed
```

## Compatibility

The packages retain Next.js 14 and 15 and support Next.js 16. Use a valid
Next.js/Node.js pairing for the host major:

| Next.js | Node.js requirement | Integration |
| --- | --- | --- |
| 14 | `>=18.17` | `middleware.ts` + `@ops-ai/nextjs-toggly-edge` |
| 15 | `^18.18 \|\| ^19.8 \|\| >=20` | `middleware.ts` + server/client packages |
| 16 | `>=20.9` | `proxy.ts` (`createFeatureProxy`), server/client packages, and optional Cache Components |

Server helpers keep request context in `runWithEvalContext` and partition
cached gates by that context. For Next 16 Cache Components, render request API
access below a `<Suspense>` boundary (or another permitted Cache Components
boundary), outside a `'use cache'` scope, then pass the resulting identity or
request data to the helper:

```tsx
import { Suspense } from 'react'
import { headers } from 'next/headers'
import { cachedIsFeatureOn } from '@ops-ai/nextjs-toggly-server'

async function RequestFeatureGate() {
  const identity = (await headers()).get('x-toggly-identity') ?? 'anonymous'
  const enabled = await cachedIsFeatureOn('vip-only', { identity, revalidate: 60 })
  return <p>{String(enabled)}</p>
}

export default function Page() {
  return (
    <Suspense fallback={<p>Loading feature gate…</p>}>
      <RequestFeatureGate />
    </Suspense>
  )
}
```

The Edge package retains `createFeatureMiddleware` for applications that still
need the Edge middleware runtime; Next 16 Proxy runs in Node.js.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- Root SDK catalog: [`../README.md`](../README.md)

## License

[MIT](../LICENSE)

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
