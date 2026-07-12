import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  SDK_ID,
  SDK_VERSION,
  SDK_HEADER_ID,
  SDK_HEADER_VERSION,
  sdkUserAgent,
  sdkCustomHeaders,
  appendSdkQueryParams,
  usesSdkCustomHeaders,
  buildDefinitionFetchHeaders,
} from '../src/sdk-identity'

describe('sdk-identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes sdk constants and user agent', () => {
    expect(SDK_ID).toBe('node')
    expect(SDK_VERSION).toBeTruthy()
    expect(sdkUserAgent()).toBe(`toggly-${SDK_ID}/${SDK_VERSION}`)
    expect(sdkCustomHeaders()).toEqual({
      [SDK_HEADER_ID]: SDK_ID,
      [SDK_HEADER_VERSION]: SDK_VERSION,
    })
  })

  it('appends sdk query params', () => {
    const params = new URLSearchParams()
    appendSdkQueryParams(params)
    expect(params.get('sdk')).toBe(SDK_ID)
    expect(params.get('sdkVersion')).toBe(SDK_VERSION)
  })

  it('uses User-Agent on node by default', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('navigator', undefined)
    expect(usesSdkCustomHeaders()).toBe(false)
    expect(buildDefinitionFetchHeaders({ Accept: 'application/json' })).toEqual({
      Accept: 'application/json',
      'User-Agent': sdkUserAgent(),
    })
  })

  it('uses custom headers in browser-like environments', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    expect(usesSdkCustomHeaders()).toBe(true)
    expect(buildDefinitionFetchHeaders()).toEqual(sdkCustomHeaders())
  })

  it('uses custom headers for React Native navigator product', () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    vi.stubGlobal('navigator', { product: 'ReactNative' })
    expect(usesSdkCustomHeaders()).toBe(true)
    expect(buildDefinitionFetchHeaders()).toEqual(sdkCustomHeaders())
  })
})
