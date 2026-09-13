import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSubtleCrypto as getBrowserSubtleCrypto } from './webcrypto.browser'
import { getSubtleCrypto as getNodeSubtleCrypto } from './webcrypto'
import { base64ToBytes } from './signed-defs-verify'

afterEach(() => vi.unstubAllGlobals())

describe('runtime WebCrypto providers', () => {
  it('provides Node WebCrypto without a global crypto object', async () => {
    vi.stubGlobal('crypto', undefined)
    const digest = await getNodeSubtleCrypto().digest('SHA-256', new Uint8Array())
    expect(new Uint8Array(digest)).toHaveLength(32)
  })

  it('uses platform WebCrypto in browsers', () => {
    expect(getBrowserSubtleCrypto()).toBe(globalThis.crypto.subtle)
  })

  it('reports missing browser WebCrypto', () => {
    vi.stubGlobal('crypto', undefined)
    expect(getBrowserSubtleCrypto).toThrow(/WebCrypto is required/)
  })

  it('decodes URL-safe base64 through atob without Buffer', () => {
    vi.stubGlobal('Buffer', undefined)
    expect(base64ToBytes('-_8')).toEqual(new Uint8Array([251, 255]))
  })

  it('reports when no base64 decoder is available', () => {
    vi.stubGlobal('Buffer', undefined)
    vi.stubGlobal('atob', undefined)
    expect(() => base64ToBytes('AA')).toThrow(/base64 decoding is not available/)
  })
})
