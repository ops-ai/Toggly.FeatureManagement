import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  createFeatureMiddleware,
  createFeatureProxy,
  isFeatureEnabledForRequest,
  getFeaturesForRequest,
} from '../src/middleware'
import {
  initEdgeToggly,
  getEdgeToggly,
  resetEdgeToggly,
} from '../src/edge-client'
import type { FeatureDefinitionModel } from '@ops-ai/nextjs-toggly-core'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createMockResponse(data: unknown) {
  const bodyText = JSON.stringify(data)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => bodyText,
    json: async () => data,
  }
}

function targeting(featureKey: string, identity: string): FeatureDefinitionModel {
  return {
    featureKey,
    filters: [
      {
        name: 'Targeting',
        parameters: {
          'Audience.Users:0': identity,
          'Audience.DefaultRolloutPercentage': 0,
        },
      },
    ],
  }
}

function makeRequest(path: string, identity?: string) {
  const headers = new Headers()
  if (identity) {
    headers.set('x-toggly-identity', identity)
  }
  return new NextRequest(new URL(path, 'http://localhost'), { headers })
}

describe('edge middleware identity safety [OPS-831]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetEdgeToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetEdgeToggly()
    vi.restoreAllMocks()
  })

  it('does not mutate the shared client identity across concurrent requests', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse([targeting('vip-only', 'alice')]),
    )

    const config = {
      appKey: 'test-key',
      identity: 'shared-default',
      cache: false,
      enableUsageTracking: false,
      enableMetrics: false,
    }
    await initEdgeToggly(config)
    const sharedBefore = getEdgeToggly()!.identity

    const middleware = createFeatureMiddleware(config)

    const [aliceRes, bobRes] = await Promise.all([
      middleware(makeRequest('/vip', 'alice'), { featureKey: 'vip-only' }),
      middleware(makeRequest('/vip', 'bob'), { featureKey: 'vip-only' }),
    ])

    expect(aliceRes.status).toBe(200)
    expect(bobRes.status).toBe(404)
    expect(getEdgeToggly()!.identity).toBe(sharedBefore)
  })

  it('isFeatureEnabledForRequest evaluates with request identity overrides', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse([targeting('vip-only', 'alice')]),
    )

    const config = {
      appKey: 'test-key',
      identity: 'shared-default',
      enableUsageTracking: false,
      enableMetrics: false,
    }

    await expect(
      isFeatureEnabledForRequest(makeRequest('/x', 'alice'), 'vip-only', config),
    ).resolves.toBe(true)
    await expect(
      isFeatureEnabledForRequest(makeRequest('/x', 'bob'), 'vip-only', config),
    ).resolves.toBe(false)
    expect(getEdgeToggly()!.identity).toBe('shared-default')
  })

  it('getFeaturesForRequest snapshots for the request identity', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse([targeting('vip-only', 'alice')]),
    )

    const config = {
      appKey: 'test-key',
      enableUsageTracking: false,
      enableMetrics: false,
    }
    const features = await getFeaturesForRequest(
      makeRequest('/x', 'alice'),
      config,
    )

    expect(features['vip-only']).toBe(true)
  })

  it('creates a Next 16 proxy without installing a process-wide client', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse([targeting('vip-only', 'alice')]),
    )

    const proxy = createFeatureProxy({
      config: {
        appKey: 'test-key',
        identity: 'shared-default',
        cache: false,
        enableUsageTracking: false,
        enableMetrics: false,
      },
      feature: { featureKey: 'vip-only' },
    })

    const [aliceRes, bobRes] = await Promise.all([
      proxy(makeRequest('/vip', 'alice')),
      proxy(makeRequest('/vip', 'bob')),
    ])

    expect(aliceRes.status).toBe(200)
    expect(bobRes.status).toBe(404)
    expect(getEdgeToggly()).toBeNull()
  })

  it('keeps disabled responses and destinations available through the Next 16 proxy', async () => {
    mockFetch.mockResolvedValue(
      createMockResponse([targeting('vip-only', 'alice')]),
    )

    const config = {
      appKey: 'test-key',
      cache: false,
      enableUsageTracking: false,
      enableMetrics: false,
    }
    const request = makeRequest('/vip', 'bob')

    const customResponse = await createFeatureProxy({
      config,
      feature: {
        featureKey: 'vip-only',
        requirement: 'all',
        negate: false,
        onDisabled: () => new Response('membership required', { status: 451 }),
      },
    })(request)
    expect(customResponse.status).toBe(451)
    await expect(customResponse.text()).resolves.toBe('membership required')

    const redirect = await createFeatureProxy({
      config,
      feature: {
        featureKey: 'vip-only',
        redirectTo: '/waitlist',
        redirectStatus: 302,
      },
    })(request)
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('http://localhost/waitlist')

    const defaultRedirect = await createFeatureProxy({
      config,
      feature: { featureKey: 'vip-only', redirectTo: '/waitlist' },
    })(request)
    expect(defaultRedirect.status).toBe(307)

    const rewrite = await createFeatureProxy({
      config,
      feature: { featureKey: 'vip-only', rewriteTo: '/waitlist' },
    })(request)
    expect(rewrite.headers.get('x-middleware-rewrite')).toBe('http://localhost/waitlist')
  })
})
