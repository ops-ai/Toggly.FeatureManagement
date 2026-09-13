import { Suspense } from 'react'
import { headers } from 'next/headers'
import { cachedIsFeatureOn } from '@ops-ai/nextjs-toggly-server'

async function RequestFeatureGate() {
  const identity = (await headers()).get('x-toggly-identity') ?? 'anonymous'
  const enabled = await cachedIsFeatureOn('vip-only', { identity, revalidate: 60 })
  return <p id="feature-gate">{String(enabled)}</p>
}

export default function Page() {
  return (
    <Suspense fallback={<p id="feature-gate-loading">Loading feature gate…</p>}>
      <RequestFeatureGate />
    </Suspense>
  )
}
