import { describe, it, expect, afterEach } from 'vitest'
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
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalDocument = (globalThis as { document?: unknown }).document
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window
    } else {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }
    if (originalDocument === undefined) {
      delete (globalThis as { document?: unknown }).document
    } else {
      ;(globalThis as { document?: unknown }).document = originalDocument
    }
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      ;(globalThis as { navigator?: unknown }).navigator = originalNavigator
    }
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
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { document?: unknown }).document
    delete (globalThis as { navigator?: unknown }).navigator
    expect(usesSdkCustomHeaders()).toBe(false)
    expect(buildDefinitionFetchHeaders({ Accept: 'application/json' })).toEqual({
      Accept: 'application/json',
      'User-Agent': sdkUserAgent(),
    })
  })

  it('uses custom headers in browser-like environments', () => {
    ;(globalThis as { window?: unknown }).window = {}
    ;(globalThis as { document?: unknown }).document = {}
    expect(usesSdkCustomHeaders()).toBe(true)
    expect(buildDefinitionFetchHeaders()).toEqual(sdkCustomHeaders())
  })

  it('uses custom headers for React Native navigator product', () => {
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { document?: unknown }).document
    ;(globalThis as { navigator?: { product?: string } }).navigator = { product: 'ReactNative' }
    expect(usesSdkCustomHeaders()).toBe(true)
    expect(buildDefinitionFetchHeaders()).toEqual(sdkCustomHeaders())
  })
})
