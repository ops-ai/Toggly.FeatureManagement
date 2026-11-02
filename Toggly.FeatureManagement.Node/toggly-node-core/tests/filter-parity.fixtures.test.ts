import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeToggly,
  createTogglyClient,
} from '../src/client'
import {
  fromHttpRequest,
  type EvalContext,
  type FeatureDefinitionModel,
  type FeatureFilter,
} from '@ops-ai/toggly-eval'

type SdkExpectation = {
  outcome?: boolean | 'error'
  allowedOutcomes?: boolean[]
}

type ParityFixture = {
  id: string
  description: string
  featureKey: string
  requirementType?: string
  filters: FeatureFilter[]
  context?: EvalContext
  httpHeaders?: Record<string, string>
  expected: boolean
  sdkExpectations?: Record<string, SdkExpectation>
}

const SDK_KEY = 'node-core'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/filter-parity/fixtures',
)

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function loadFixtures(): ParityFixture[] {
  return readdirSync(fixturesDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(fixturesDir, name), 'utf8')
      return JSON.parse(raw) as ParityFixture
    })
}

function buildContext(fixture: ParityFixture): EvalContext {
  const base = fixture.context ?? {}
  if (!fixture.httpHeaders) {
    return base
  }
  return fromHttpRequest(fixture.httpHeaders, base)
}

function resolveExpectation(fixture: ParityFixture):
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error' }
  | { kind: 'allowed'; values: boolean[] } {
  const override = fixture.sdkExpectations?.[SDK_KEY]
  if (override?.outcome === 'error') {
    return { kind: 'error' }
  }
  if (Array.isArray(override?.allowedOutcomes) && override.allowedOutcomes.length > 0) {
    return { kind: 'allowed', values: override.allowedOutcomes }
  }
  if (typeof override?.outcome === 'boolean') {
    return { kind: 'boolean', value: override.outcome }
  }
  return { kind: 'boolean', value: fixture.expected }
}

function defsResponse(definitions: FeatureDefinitionModel[]) {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify(definitions),
    json: async () => definitions,
  }
}

describe('filter-parity golden fixtures (node-core)', () => {
  const fixtures = loadFixtures()

  beforeEach(() => {
    vi.clearAllMocks()
    closeToggly()
  })

  afterEach(() => {
    closeToggly()
  })

  it('loads the required Wave 1 cases', () => {
    const ids = new Set(fixtures.map((f) => f.id))
    for (const required of [
      'browser-family-match',
      'browser-family-miss',
      'browser-language-match',
      'country-from-request',
      'country-from-cf-ipcountry',
      'device-type-match',
      'os-match',
      'user-claims-match',
      'user-claims-miss',
      'targeting-groups-match',
      'targeting-rollout-100-anonymous',
      'targeting-rollout-partial-anonymous',
      'percentage-missing-fail-closed',
      'percentage-zero-fail-closed',
      'unknown-filter-fail-closed',
    ]) {
      expect(ids.has(required), `missing fixture ${required}`).toBe(true)
    }
  })

  for (const fixture of fixtures) {
    it(`${fixture.id}: ${fixture.description}`, async () => {
      const definition: FeatureDefinitionModel = {
        featureKey: fixture.featureKey,
        requirementType: fixture.requirementType,
        filters: fixture.filters,
      }

      mockFetch.mockResolvedValueOnce(defsResponse([definition]))

      // Omit identity so node-core mints an anonymous UUID (owner-approved behavior).
      // Per-call fixture identity / request fields still flow through isFeatureOn context.
      const client = createTogglyClient({
        appKey: 'parity-app',
        environment: 'Production',
        enableStreaming: false,
        enableFileCache: false,
      })
      await client.init()

      const context = buildContext(fixture)
      const expectation = resolveExpectation(fixture)

      if (expectation.kind === 'error') {
        await expect(client.isFeatureOn(fixture.featureKey, context)).rejects.toThrow()
        return
      }

      const actual = await client.isFeatureOn(fixture.featureKey, context)
      expect(typeof actual).toBe('boolean')

      if (expectation.kind === 'allowed') {
        expect(expectation.values).toContain(actual)
        return
      }

      expect(actual).toBe(expectation.value)
    })
  }
})
