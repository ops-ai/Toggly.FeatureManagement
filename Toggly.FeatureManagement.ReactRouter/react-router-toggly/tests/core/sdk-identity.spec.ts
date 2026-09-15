import {
  SDK_ID,
  SDK_VERSION,
  sdkUserAgent,
  sdkCustomHeaders,
  appendSdkQueryParams,
  usesSdkCustomHeaders,
  buildDefinitionFetchHeaders,
  SDK_HEADER_ID,
  SDK_HEADER_VERSION,
} from '../../src/core/sdk-identity'

describe('sdk-identity', () => {
  it('exposes react-router SDK id and versioned user agent', () => {
    expect(SDK_ID).toBe('react-router')
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(sdkUserAgent()).toBe(`toggly-react-router/${SDK_VERSION}`)
  })

  it('builds custom headers and query params', () => {
    expect(sdkCustomHeaders()).toEqual({
      [SDK_HEADER_ID]: SDK_ID,
      [SDK_HEADER_VERSION]: SDK_VERSION,
    })
    const params = new URLSearchParams()
    appendSdkQueryParams(params)
    expect(params.get('sdk')).toBe('react-router')
    expect(params.get('sdkVersion')).toBe(SDK_VERSION)
  })

  it('uses User-Agent on Node and custom headers in browser-like globals', () => {
    expect(usesSdkCustomHeaders()).toBe(false)
    expect(buildDefinitionFetchHeaders({ Accept: 'application/json' })['User-Agent']).toBe(
      sdkUserAgent(),
    )

    const g = globalThis as typeof globalThis & {
      window?: unknown
      document?: unknown
      navigator?: { product?: string }
    }
    const prevWindow = g.window
    const prevDocument = g.document
    const prevNavigator = g.navigator
    g.window = {}
    g.document = {}
    try {
      expect(usesSdkCustomHeaders()).toBe(true)
      const headers = buildDefinitionFetchHeaders()
      expect(headers[SDK_HEADER_ID]).toBe('react-router')
      expect(headers['User-Agent']).toBeUndefined()
    } finally {
      if (prevWindow === undefined) delete g.window
      else g.window = prevWindow
      if (prevDocument === undefined) delete g.document
      else g.document = prevDocument
    }

    delete g.window
    delete g.document
    g.navigator = { product: 'ReactNative' }
    try {
      expect(usesSdkCustomHeaders()).toBe(true)
    } finally {
      if (prevNavigator === undefined) delete g.navigator
      else g.navigator = prevNavigator
    }
  })
})
