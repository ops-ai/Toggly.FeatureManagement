import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allocateVariant } from './variant-allocator'
import type { FeatureDefinitionModel } from './types'

/**
 * Replays the shared Microsoft.FeatureManagement 4.7.0 gold corpus (see
 * `variant-allocator-corpus/README.md` at the repo root) against this
 * package's catalog-local `allocateVariant`. Every Toggly backend SDK that
 * implements catalog-local feature variants asserts an exact match against
 * this same corpus, so all SDKs stay bit-for-bit compatible with
 * Microsoft.FeatureManagement's variant-assignment algorithm.
 */

interface CorpusVariant {
  name: string
  configurationValue: unknown
  statusOverride: 'None' | 'Enabled' | 'Disabled'
}

interface CorpusAllocation {
  defaultWhenEnabled: string | null
  defaultWhenDisabled: string | null
  seed: string | null
  user: { variant: string; users: string[] }[] | null
  group: { variant: string; groups: string[] }[] | null
  percentile: { variant: string; from: number; to: number }[] | null
}

interface CorpusCase {
  id: string
  feature: {
    name: string
    enabledFor: { name: string }[]
    variants: CorpusVariant[]
    allocation: CorpusAllocation | null
  }
  targeting: {
    userId: string | null
    groups: string[]
  }
  expected: {
    variantName: string | null
    configurationValue: unknown
    enabled: boolean
    assignmentReason: string
  }
  ignoreCase?: boolean
}

const corpusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../variant-allocator-corpus/cases.json',
)

function loadCorpus(): CorpusCase[] {
  const raw = readFileSync(corpusPath, 'utf8')
  return JSON.parse(raw) as CorpusCase[]
}

describe('variant allocator gold corpus (Microsoft.FeatureManagement 4.7.0 parity)', () => {
  const cases = loadCorpus()

  it('loads a non-empty corpus', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const testCase of cases) {
    it(`${testCase.id}`, () => {
      const def: FeatureDefinitionModel = {
        featureKey: testCase.feature.name,
        filters: testCase.feature.enabledFor,
        variants: testCase.feature.variants,
        allocation: testCase.feature.allocation,
      }

      const result = allocateVariant(
        def,
        {
          identity: testCase.targeting.userId ?? undefined,
          groups: testCase.targeting.groups,
        },
        { ignoreCase: testCase.ignoreCase ?? false },
      )

      expect(result.variantName).toBe(testCase.expected.variantName)
      expect(result.configurationValue).toEqual(testCase.expected.configurationValue)
      expect(result.enabled).toBe(testCase.expected.enabled)
      expect(result.assignmentReason).toBe(testCase.expected.assignmentReason)
    })
  }
})
