import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  evaluateDefinition,
  fromHttpRequest,
  type EvalContext,
  type FeatureDefinitionModel,
  type FeatureFilter,
} from './index'

type ParityFixture = {
  id: string
  description: string
  featureKey: string
  requirementType?: string
  filters: FeatureFilter[]
  context?: EvalContext
  httpHeaders?: Record<string, string>
  expected: boolean
}

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../docs/filter-parity/fixtures',
)

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

describe('filter-parity golden fixtures', () => {
  const fixtures = loadFixtures()

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
      'percentage-missing-fail-closed',
      'percentage-zero-fail-closed',
      'unknown-filter-fail-closed',
    ]) {
      expect(ids.has(required), `missing fixture ${required}`).toBe(true)
    }
  })

  for (const fixture of fixtures) {
    it(`${fixture.id}: ${fixture.description}`, () => {
      const def: FeatureDefinitionModel = {
        featureKey: fixture.featureKey,
        requirementType: fixture.requirementType,
        filters: fixture.filters,
      }
      const actual = evaluateDefinition(def, buildContext(fixture))
      expect(actual).toBe(fixture.expected)
    })
  }
})
