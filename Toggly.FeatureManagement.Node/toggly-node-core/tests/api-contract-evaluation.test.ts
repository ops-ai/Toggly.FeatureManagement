import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeToggly, createTogglyClient } from '../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

/**
 * Contract tests: real local HTTP matching definitions-signed response shapes,
 * then catalog-local evaluation (AlwaysOn / AlwaysOff / Targeting / Percentage).
 * Does not change public API — only asserts existing fetch + evaluate behavior.
 */

const DEFINITIONS: FeatureDefinitionModel[] = [
  { featureKey: 'always-on', filters: [{ name: 'AlwaysOn', parameters: {} }] },
  { featureKey: 'always-off', filters: [{ name: 'AlwaysOff', parameters: {} }] },
  {
    featureKey: 'beta',
    filters: [
      {
        name: 'Targeting',
        parameters: {
          'Audience.Users:0': 'alice',
          'Audience.DefaultRolloutPercentage': 0,
        },
      },
    ],
  },
  {
    featureKey: 'pct-full',
    filters: [{ name: 'Percentage', parameters: { Value: 100 } }],
  },
]

async function listenDefinitions(
  bodyFactory: () => string,
): Promise<{ baseUrl: string; close: () => Promise<void>; lastUrl: () => string | undefined }> {
  let lastUrl: string | undefined
  const server = createServer((request, response) => {
    lastUrl = request.url
    response.writeHead(200, { 'content-type': 'application/json', etag: '"contract-rev-1"' })
    response.end(bodyFactory())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    lastUrl: () => lastUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

describe('definitions-signed API contract evaluation', () => {
  beforeEach(() => {
    closeToggly()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    closeToggly()
  })

  it('evaluates flags from a bare definitions array response', async () => {
    const definitions = await listenDefinitions(() => JSON.stringify(DEFINITIONS))
    try {
      const client = createTogglyClient({
        appKey: 'contract-app',
        baseUrl: definitions.baseUrl,
        environment: 'Production',
        identity: 'bob',
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        refreshInterval: 0,
        registerContextsOnStartup: false,
      })
      await client.init()

      expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Production')
      await expect(client.isFeatureOn('always-on')).resolves.toBe(true)
      await expect(client.isFeatureOn('always-off')).resolves.toBe(false)
      await expect(client.isFeatureOn('beta')).resolves.toBe(false)
      await expect(client.isFeatureOn('beta', { identity: 'alice' })).resolves.toBe(true)
      await expect(client.isFeatureOn('pct-full')).resolves.toBe(true)
      await expect(client.isFeatureOn('missing')).resolves.toBe(false)
    } finally {
      await definitions.close()
    }
  })

  it('evaluates flags from an unsigned { defs } envelope response', async () => {
    const definitions = await listenDefinitions(() =>
      JSON.stringify({ defs: DEFINITIONS }),
    )
    try {
      const client = createTogglyClient({
        appKey: 'contract-app',
        baseUrl: definitions.baseUrl,
        environment: 'Staging',
        identity: 'bob',
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        refreshInterval: 0,
        registerContextsOnStartup: false,
      })
      await client.init()

      expect(definitions.lastUrl()).toBe('/definitions-signed/contract-app/Staging')
      expect(client.state.definitions.size).toBe(4)
      await expect(client.isFeatureOn('always-on')).resolves.toBe(true)
      await expect(client.isFeatureOn('always-off')).resolves.toBe(false)
      await expect(client.isFeatureOn('beta')).resolves.toBe(false)
      await expect(client.isFeatureOn('beta', { identity: 'alice' })).resolves.toBe(true)
      await expect(client.isFeatureOn('pct-full')).resolves.toBe(true)
    } finally {
      await definitions.close()
    }
  })

  it('refreshes and re-evaluates when the definitions-signed body changes', async () => {
    let body = JSON.stringify({
      defs: [{ featureKey: 'flip', filters: [{ name: 'AlwaysOn', parameters: {} }] }],
    })
    const definitions = await listenDefinitions(() => body)
    try {
      const client = createTogglyClient({
        appKey: 'contract-app',
        baseUrl: definitions.baseUrl,
        enableStreaming: false,
        enableUsageTracking: false,
        enableMetrics: false,
        refreshInterval: 0,
        registerContextsOnStartup: false,
        useEtag: false,
      })
      await client.init()
      await expect(client.isFeatureOn('flip')).resolves.toBe(true)

      body = JSON.stringify({
        defs: [{ featureKey: 'flip', filters: [{ name: 'AlwaysOff', parameters: {} }] }],
      })
      await client.refresh()
      await expect(client.isFeatureOn('flip')).resolves.toBe(false)
    } finally {
      await definitions.close()
    }
  })
})
