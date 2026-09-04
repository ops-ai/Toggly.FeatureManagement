import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FeatureDefinitionModel } from '@ops-ai/nextjs-toggly-core'
import {
  getAmbientEvalOverrides,
  mergeFeatureCheckOptions,
  runWithEvalContext,
  withEvalContext,
} from '../src/eval-context-store'
import { Feature } from '../src/components'
import {
  initServerToggly,
  isServerFeatureOn,
  resetServerToggly,
  useServerToggly,
} from '../src/server-client'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const targetingAlice: FeatureDefinitionModel = {
  featureKey: 'targeted-flag',
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

const claimsFlag: FeatureDefinitionModel = {
  featureKey: 'claims-flag',
  filters: [
    {
      name: 'UserClaims',
      parameters: { Percentage: 100, Claim: 'role', Value: 'admin' },
    },
  ],
}

const countryFlag: FeatureDefinitionModel = {
  featureKey: 'country-flag',
  filters: [
    {
      name: 'Country',
      parameters: { Percentage: 100, 'Country:0': 'US' },
    },
  ],
}

function defsResponse(definitions: FeatureDefinitionModel[], status = 200) {
  const body = JSON.stringify(definitions)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => body,
    json: async () => definitions,
    headers: { get: () => null },
  }
}

describe('mergeFeatureCheckOptions', () => {
  it('returns per-call when ambient is missing', () => {
    expect(mergeFeatureCheckOptions(undefined, { identity: 'a' })).toEqual({
      identity: 'a',
    })
  })

  it('lets per-call fields win field-by-field', () => {
    expect(
      mergeFeatureCheckOptions(
        {
          identity: 'ambient',
          groups: ['beta'],
          claims: { role: 'user' },
          headers: { 'cf-ipcountry': 'US' },
        },
        {
          identity: 'override',
          claims: { role: 'admin' },
        }
      )
    ).toEqual({
      identity: 'override',
      groups: ['beta'],
      claims: { role: 'admin' },
      headers: { 'cf-ipcountry': 'US' },
      request: undefined,
      context: undefined,
      contextKind: undefined,
    })
  })
})

describe('ambient EvalContext store', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetServerToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    resetServerToggly()
    vi.restoreAllMocks()
  })

  it('exposes nothing outside a bind', () => {
    expect(getAmbientEvalOverrides()).toBeUndefined()
  })

  it('binds ambient for isServerFeatureOn without per-call props', async () => {
    mockFetch.mockResolvedValueOnce(
      defsResponse([targetingAlice, claimsFlag, countryFlag])
    )

    await initServerToggly({
      appKey: 'test-key',
      identity: 'bob',
      enableLiveUpdates: false,
    })

    const shared = useServerToggly()

    await runWithEvalContext(
      {
        identity: 'alice',
        claims: { role: 'admin' },
        headers: { 'cf-ipcountry': 'US' },
      },
      async () => {
        expect(await isServerFeatureOn('targeted-flag')).toBe(true)
        expect(await isServerFeatureOn('claims-flag')).toBe(true)
        expect(await isServerFeatureOn('country-flag')).toBe(true)
      }
    )

    expect(await isServerFeatureOn('targeted-flag')).toBe(false)
    expect(shared.identity).toBe('bob')
  })

  it('lets per-call options override ambient field-by-field', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([targetingAlice, claimsFlag]))

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
    })

    await runWithEvalContext(
      {
        identity: 'alice',
        claims: { role: 'admin' },
      },
      async () => {
        expect(await isServerFeatureOn('targeted-flag')).toBe(true)
        expect(
          await isServerFeatureOn('targeted-flag', { identity: 'bob' })
        ).toBe(false)
        // claims still ambient when only identity overridden
        expect(
          await isServerFeatureOn('claims-flag', { identity: 'bob' })
        ).toBe(true)
        expect(
          await isServerFeatureOn('claims-flag', {
            claims: { role: 'user' },
          })
        ).toBe(false)
      }
    )
  })

  it('isolates nested and concurrent ambient binds', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([targetingAlice]))

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
    })

    const nested = await runWithEvalContext({ identity: 'alice' }, async () => {
      expect(getAmbientEvalOverrides()?.identity).toBe('alice')
      const inner = await runWithEvalContext({ identity: 'bob' }, async () => {
        expect(getAmbientEvalOverrides()?.identity).toBe('bob')
        return isServerFeatureOn('targeted-flag')
      })
      expect(getAmbientEvalOverrides()?.identity).toBe('alice')
      expect(inner).toBe(false)
      return isServerFeatureOn('targeted-flag')
    })
    expect(nested).toBe(true)
    expect(getAmbientEvalOverrides()).toBeUndefined()

    const [left, right] = await Promise.all([
      runWithEvalContext({ identity: 'alice' }, () =>
        isServerFeatureOn('targeted-flag')
      ),
      runWithEvalContext({ identity: 'bob' }, () =>
        isServerFeatureOn('targeted-flag')
      ),
    ])
    expect(left).toBe(true)
    expect(right).toBe(false)
  })

  it('withEvalContext resolves a provider then binds', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([targetingAlice]))

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
    })

    const result = await withEvalContext(
      async () => ({ identity: 'alice' }),
      () => isServerFeatureOn('targeted-flag')
    )
    expect(result).toBe(true)
    expect(getAmbientEvalOverrides()).toBeUndefined()
  })

  it('Feature uses ambient without identity/groups/claims/headers props', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([claimsFlag]))

    await initServerToggly({
      appKey: 'test-key',
      enableLiveUpdates: false,
    })

    const rendered = await runWithEvalContext(
      { claims: { role: 'admin' } },
      () =>
        Feature({
          featureKey: 'claims-flag',
          children: 'visible',
        })
    )
    expect(rendered).toBe('visible')

    const hidden = await Feature({
      featureKey: 'claims-flag',
      children: 'visible',
    })
    expect(hidden).toBeNull()
  })

  it('does not mutate process-global client identity under concurrent binds', async () => {
    mockFetch.mockResolvedValueOnce(defsResponse([targetingAlice]))

    await initServerToggly({
      appKey: 'test-key',
      identity: 'shared-user',
      enableLiveUpdates: false,
    })

    const shared = useServerToggly()

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runWithEvalContext(
          { identity: i % 2 === 0 ? 'alice' : 'bob' },
          () => isServerFeatureOn('targeted-flag')
        )
      )
    )

    expect(shared.identity).toBe('shared-user')
    expect(useServerToggly().identity).toBe('shared-user')
  })
})
