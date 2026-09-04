import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useIdentity, useFeatureFlag, useToggly } from '../src'
import { TogglyProvider } from '../src/context'
import type { ReactNode } from 'react'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const localStorageMock = {
  store: {} as Record<string, string>,
  getItem: vi.fn((key: string) => localStorageMock.store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageMock.store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageMock.store[key]
  }),
  clear: vi.fn(() => {
    localStorageMock.store = {}
  }),
}
vi.stubGlobal('localStorage', localStorageMock)

function createMockResponse(data: unknown, status = 200) {
  const bodyText = typeof data === 'string' ? data : JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => bodyText,
    json: async () => (typeof data === 'string' ? JSON.parse(data) : data),
    headers: { get: () => null },
  }
}

describe('TogglyProvider identity safety [OPS-828]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorageMock.store = {}
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not publish a new identity when setIdentity refresh fails', async () => {
    mockFetch
      .mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'Gated', enabled: true }],
        }),
      )
      .mockRejectedValueOnce(new Error('refresh failed'))

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <TogglyProvider
          config={{
            appKey: 'test-key',
            identity: 'user-a',
            refreshInterval: 0,
            enableLiveUpdates: false,
            persistIdentity: true,
          }}
          autoInit
        >
          {children}
        </TogglyProvider>
      )
    }

    function useSubject() {
      const identity = useIdentity()
      const flag = useFeatureFlag('Gated')
      const toggly = useToggly()
      return { identity, flag, toggly }
    }

    const { result } = renderHook(() => useSubject(), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.toggly.isReady).toBe(true)
      expect(result.current.flag.isEnabled).toBe(true)
    })

    await act(async () => {
      await expect(
        result.current.identity.setIdentity('user-b'),
      ).rejects.toThrow('refresh failed')
    })

    expect(result.current.identity.identity).toBe('user-a')
    expect(result.current.flag.isEnabled).toBe(true)
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
      'toggly:identity',
      'user-b',
    )
  })

  it('seeds React features from persisted last-known-good defs', async () => {
    localStorageMock.store['toggly:features'] = JSON.stringify({
      'feature-a': true,
      'feature-b': false,
    })

    mockFetch.mockRejectedValueOnce(new Error('offline'))

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <TogglyProvider
          config={{
            appKey: 'test-key',
            persistFeatures: true,
            featuresStorageKey: 'toggly:features',
            refreshInterval: 0,
            enableLiveUpdates: false,
          }}
          autoInit
        >
          {children}
        </TogglyProvider>
      )
    }

    const { result } = renderHook(() => useToggly(), { wrapper: Wrapper })

    // Seeded before/during init — persisted flags visible even if fetch fails
    expect(result.current.features['feature-a']).toBe(true)
    expect(result.current.features['feature-b']).toBe(false)

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.features['feature-a']).toBe(true)
  })
})
