import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computePercentile } from './hash'

const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'testdata',
  'eval-percentile-golden.json',
)

interface GoldenRow {
  featureKey: string
  userId: string
  bucket: number
}

describe('computePercentile (SHA-256 LE)', () => {
  it('matches Definitions golden vectors', () => {
    const rows = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenRow[]
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const got = computePercentile(row.userId, row.featureKey)
      expect(got).toBeCloseTo(row.bucket, 12)
    }
  })

  it('is sticky for the same user+feature and differs across features', () => {
    const a = computePercentile('user-123', 'demo-feature')
    const b = computePercentile('user-123', 'demo-feature')
    const c = computePercentile('user-123', 'other-flag')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
