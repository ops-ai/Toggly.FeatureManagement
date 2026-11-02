import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTogglyClient } from '../src/client'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'

/**
 * Contract tests: mocked HTTP bodies match the Toggly definitions/evaluated
 * API shapes, and isFeatureOn reflects real evaluation — not build-only checks.
 */
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function httpJson(data: unknown, status = 200) {
  const body = JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
    json: async () => data,
    headers: { get: () => null },
  }
}

const alwaysOn: FeatureDefinitionModel = {
  featureKey: 'AlwaysOnFlag',
  filters: [{ name: 'AlwaysOn', parameters: {} }],
}

const alwaysOff: FeatureDefinitionModel = {
  featureKey: 'AlwaysOffFlag',
  filters: [{ name: 'AlwaysOff', parameters: {} }],
}

const targetingAlice: FeatureDefinitionModel = {
  featureKey: 'TargetedFlag',
  filters: [
    {
      name: 'Targeting',
      parameters: {
        'Audience.Users:0': 'alice',
        'Audience.DefaultRolloutPercentage': 0,
      },
    },
  ],
}

describe('Toggly API contract — flag evaluation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('remote rail (evaluated-signed)', () => {
    it('GETs evaluated-signed and evaluates a defs map envelope', async () => {
      mockFetch.mockResolvedValueOnce(
        httpJson({ defs: { 'feature-on': true, 'feature-off': false } }),
      )

      const client = createTogglyClient({
        appKey: 'app-key',
        environment: 'Production',
        identity: 'user-1',
        refreshInterval: 0,
        enableLiveUpdates: false,
      })
      await client.init()

      const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
      expect(url.pathname).toBe('/evaluated-signed/app-key/Production')
      expect(url.searchParams.get('u')).toBe('user-1')

      await expect(client.isFeatureOn('feature-on')).resolves.toBe(true)
      await expect(client.isFeatureOn('feature-off')).resolves.toBe(false)
      await expect(client.isFeatureOn('missing')).resolves.toBe(false)
      client.destroy()
    })

    it('evaluates the features[] evaluated-signed envelope', async () => {
      mockFetch.mockResolvedValueOnce(
        httpJson({
          features: [
            { featureKey: 'alpha', enabled: true },
            { featureKey: 'beta', enabled: false },
          ],
        }),
      )

      const client = createTogglyClient({
        appKey: 'app-key',
        refreshInterval: 0,
        enableLiveUpdates: false,
      })
      await client.init()

      expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/evaluated-signed/')
      await expect(client.isFeatureOn('alpha')).resolves.toBe(true)
      await expect(client.isFeatureOn('beta')).resolves.toBe(false)
      client.destroy()
    })
  })

  describe('local rail (definitions-signed)', () => {
    it('GETs definitions-signed and evaluates filter models locally', async () => {
      mockFetch.mockResolvedValueOnce(
        httpJson([alwaysOn, alwaysOff, targetingAlice]),
      )

      const client = createTogglyClient({
        appKey: 'app-key',
        environment: 'Staging',
        evaluationMode: 'local',
        identity: 'alice',
        refreshInterval: 0,
        enableLiveUpdates: false,
      })
      await client.init()

      const url = new URL(String(mockFetch.mock.calls[0]?.[0]))
      expect(url.pathname).toBe('/definitions-signed/app-key/Staging')
      expect(url.searchParams.get('u')).toBeNull()

      await expect(client.isFeatureOn('AlwaysOnFlag')).resolves.toBe(true)
      await expect(client.isFeatureOn('AlwaysOffFlag')).resolves.toBe(false)
      await expect(client.isFeatureOn('TargetedFlag')).resolves.toBe(true)

      await client.setIdentity('bob')
      await expect(client.isFeatureOn('TargetedFlag')).resolves.toBe(false)
      client.destroy()
    })
  })
})
