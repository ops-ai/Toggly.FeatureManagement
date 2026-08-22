import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearEntityContextSchemaRegistrations,
  getEntityContextSchemaRegistrations,
  registerContext,
  registerEntityContextsAtStartup,
} from '../src/entity-context-registration'

describe('entity context registration', () => {
  afterEach(() => {
    clearEntityContextSchemaRegistrations()
    vi.unstubAllGlobals()
  })

  it('stores schema registrations from registerContext', () => {
    registerContext(
      'Order',
      (entity: { id: string }) => ({ kind: 'Order', key: entity.id, attributes: {} }),
      {
        keyProperty: 'id',
        properties: [{ name: 'color', type: 'string' }],
      },
    )

    expect(getEntityContextSchemaRegistrations()).toEqual([
      {
        kind: 'Order',
        keyProperty: 'id',
        displayName: 'Order',
        properties: [{ name: 'color', type: 'string' }],
      },
    ])
  })

  it('skips startup registration when disabled, missing app key, or empty', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)

    await registerEntityContextsAtStartup({
      baseUrl: 'https://example.test/',
      appKey: 'app',
      registerOnStartup: false,
    })
    await registerEntityContextsAtStartup({
      baseUrl: 'https://example.test/',
      appKey: '',
    })
    await registerEntityContextsAtStartup({
      baseUrl: 'https://example.test/',
      appKey: 'app',
    })

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('PUTs registered kinds and logs debug success and failures', async () => {
    registerContext(
      'Order',
      (entity: { id: string }) => ({ kind: 'Order', key: entity.id, attributes: {} }),
      { keyProperty: 'id', properties: [{ name: 'total', type: 'number' }] },
    )

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchImpl)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await registerEntityContextsAtStartup({
      baseUrl: 'https://example.test/',
      appKey: 'app-1',
      debug: true,
    })
    await registerEntityContextsAtStartup({
      baseUrl: 'https://example.test/',
      appKey: 'app-1',
      debug: true,
    })
    await registerEntityContextsAtStartup({
      baseUrl: 'https://example.test/',
      appKey: 'app-1',
      debug: true,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(debug).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    debug.mockRestore()
    warn.mockRestore()
  })
})
