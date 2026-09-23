import { createEdgeClient } from '@ops-ai/nextjs-toggly-edge'
import { NextResponse } from 'next/server'

// Exercise the published Edge wrapper under Next's real Edge export conditions.
// No app key or transport: this regression must never send telemetry/definitions.
const client = createEdgeClient({
  featureDefaults: { EdgeExportProof: true },
  enableUsageTracking: false,
  enableMetrics: false,
})

export async function middleware() {
  const response = NextResponse.next()
  response.headers.set('x-toggly-edge-proof', String(await client.isFeatureOn('EdgeExportProof')))
  return response
}

export const config = { matcher: '/' }
