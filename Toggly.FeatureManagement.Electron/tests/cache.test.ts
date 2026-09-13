import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initToggly,
  evaluateFeatureGate,
  isFeatureOn,
  closeToggly,
  __resetTogglyForTests,
  getToggly,
} from '../src/main/client.js'

describe('feature gates', () => {
  let userDataPath: string

  beforeEach(async () => {
    __resetTogglyForTests()
    userDataPath = await mkdtemp(join(tmpdir(), 'toggly-gate-'))
    await initToggly({
      userDataPath,
      enableLiveUpdates: false,
      flagDefaults: {
        Alpha: true,
        Beta: true,
        Gamma: false,
      },
    })
  })

  afterEach(async () => {
    closeToggly()
    __resetTogglyForTests()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('all requires every key', () => {
    expect(evaluateFeatureGate(['Alpha', 'Beta'], 'all')).toBe(true)
    expect(evaluateFeatureGate(['Alpha', 'Gamma'], 'all')).toBe(false)
  })

  it('any requires one key', () => {
    expect(evaluateFeatureGate(['Gamma', 'Alpha'], 'any')).toBe(true)
    expect(evaluateFeatureGate(['Gamma'], 'any')).toBe(false)
  })

  it('negate inverts the gate', () => {
    expect(evaluateFeatureGate(['Alpha'], 'all', true)).toBe(false)
    expect(evaluateFeatureGate(['Gamma'], 'all', true)).toBe(true)
  })

  it('empty keys treat as pass unless negated', () => {
    expect(evaluateFeatureGate([])).toBe(true)
    expect(evaluateFeatureGate([], 'all', true)).toBe(false)
  })

  it('empty feature map fails closed', () => {
    const client = getToggly()!
    // Force empty features
    ;(client as unknown as { features: Record<string, unknown>; hasLoadedFlags: boolean }).features =
      {}
    expect(evaluateFeatureGate(['Alpha'], 'all')).toBe(false)
    expect(evaluateFeatureGate(['Alpha'], 'all', true)).toBe(true)
  })

  it('isFeatureOn reads single key', () => {
    expect(isFeatureOn('Alpha')).toBe(true)
    expect(isFeatureOn('Gamma')).toBe(false)
    expect(isFeatureOn('Missing')).toBe(false)
  })
})
