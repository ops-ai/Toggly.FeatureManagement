import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTogglyClient, closeToggly } from '../src/client'
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types'

const datetimeGate: EntityGate = {
  requirement: 'all',
  rules: [{ property: 'BirthDate', op: 'gt', value: '2026-01-01', type: 'datetime' }],
}

const puppyContext = {
  kind: 'Puppy',
  key: '1',
  attributes: { BirthDate: '2026-06-15T00:00:00Z' },
}

async function createClient() {
  const client = createTogglyClient({
    registerContextsOnStartup: false,
    featureDefaults: {
      PlainOn: true,
      PlainOff: false,
      EntityGated: datetimeGate,
    } as Record<string, boolean>,
  })
  await client.init()
  return client
}

describe('entity context read-time evaluation', () => {
  beforeEach(() => {
    clearRegisteredContexts()
    closeToggly()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    clearRegisteredContexts()
    closeToggly()
    vi.restoreAllMocks()
  })

  it('leaves plain booleans unchanged without context', async () => {
    const client = await createClient()
    await expect(client.isFeatureOn('PlainOn')).resolves.toBe(true)
    await expect(client.isFeatureOn('PlainOff')).resolves.toBe(false)
  })

  it('fails closed for entity gates without context', async () => {
    const client = await createClient()
    await expect(client.isFeatureOn('EntityGated')).resolves.toBe(false)
  })

  it('evaluates entity gates with matching attributes', async () => {
    const client = await createClient()
    await expect(client.isFeatureOn('EntityGated', undefined, puppyContext)).resolves.toBe(true)
  })

  it('fails closed when a mapped entity is missing the rule attribute', async () => {
    const client = await createClient()
    client.registerContext<{ id: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: {},
    }))
    await expect(client.isFeatureOn('EntityGated', undefined, { id: '9' }, 'Puppy')).resolves.toBe(
      false,
    )
  })

  it('evaluates entity gates via registerContext mapper', async () => {
    const client = await createClient()
    client.registerContext<{ id: string; birthDate: string }>('Puppy', (puppy) => ({
      kind: 'Puppy',
      key: puppy.id,
      attributes: { BirthDate: puppy.birthDate },
    }))

    await expect(
      client.isFeatureOn(
        'EntityGated',
        undefined,
        { id: '7', birthDate: '2026-06-15T00:00:00Z' },
        'Puppy',
      ),
    ).resolves.toBe(true)
    await expect(
      client.isFeatureOn(
        'EntityGated',
        undefined,
        { id: '8', birthDate: '2020-01-01T00:00:00Z' },
        'Puppy',
      ),
    ).resolves.toBe(false)
  })
})
