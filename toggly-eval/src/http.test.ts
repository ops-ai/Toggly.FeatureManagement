import { describe, expect, it } from 'vitest'
import { fromHttpRequest } from './http'

describe('fromHttpRequest', () => {
  it('maps common headers into request context', () => {
    const ctx = fromHttpRequest(
      {
        'user-agent': 'Mozilla/5.0',
        'accept-language': 'en-US',
        'cf-ipcountry': 'US',
      },
      { identity: 'u1' },
    )
    expect(ctx.identity).toBe('u1')
    expect(ctx.request).toEqual({
      userAgent: 'Mozilla/5.0',
      acceptLanguage: 'en-US',
      country: 'US',
    })
  })

  it('reads Headers.get-style bags', () => {
    const headers = {
      get(name: string) {
        if (name.toLowerCase() === 'user-agent') return 'UA'
        if (name.toLowerCase() === 'x-vercel-ip-country') return 'DE'
        return null
      },
    }
    const ctx = fromHttpRequest(headers)
    expect(ctx.request?.userAgent).toBe('UA')
    expect(ctx.request?.country).toBe('DE')
  })
})
