import { describe, it, expect } from 'vitest'
import {
  SDK_ID,
  SDK_VERSION,
  sdkUserAgent,
  sdkCustomHeaders,
  buildDefinitionFetchHeaders,
  appendSdkQueryParams,
} from '../src/sdk-identity.js'
import { IPC_CHANNELS, IPC_PREFIX } from '../src/ipc-channels.js'

describe('sdk-identity', () => {
  it('identifies as electron', () => {
    expect(SDK_ID).toBe('electron')
    expect(SDK_VERSION).toBe('1.0.0')
    expect(sdkUserAgent()).toBe(`toggly-electron/${SDK_VERSION}`)
    expect(sdkCustomHeaders()['X-Toggly-Sdk']).toBe('electron')
  })

  it('builds fetch headers', () => {
    const headers = buildDefinitionFetchHeaders({ Accept: 'application/json' })
    expect(headers['User-Agent']).toContain('electron')
    expect(headers['X-Toggly-Sdk']).toBe('electron')
    expect(headers.Accept).toBe('application/json')
  })

  it('appends sdk query params', () => {
    const params = new URLSearchParams()
    appendSdkQueryParams(params)
    expect(params.get('sdk')).toBe('electron')
    expect(params.get('sdkVersion')).toBe(SDK_VERSION)
  })
})

describe('ipc-channels', () => {
  it('uses toggly: prefix', () => {
    expect(IPC_PREFIX).toBe('toggly:')
    expect(IPC_CHANNELS.isFeatureOn).toBe('toggly:isFeatureOn')
    expect(IPC_CHANNELS.flagsUpdated).toBe('toggly:flags-updated')
  })
})
