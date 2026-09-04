import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFeatureFlag, useFeatureOff, useFeatureGate, useFeatures, useIdentity } from '../src/hooks'
import { TogglyProvider } from '../src/context'
import type { ReactNode } from 'react'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock localStorage
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
})

function createMockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => data,
  }
}

function createWrapper(config = { appKey: 'test-key' }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TogglyProvider config={config} autoInit={true}>
        {children}
      </TogglyProvider>
    )
  }
}

describe('useFeatureFlag', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return feature state', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const { result } = renderHook(() => useFeatureFlag('feature-a'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isEnabled).toBe(true)
    })

    expect(result.current.isDisabled).toBe(false)
  })

  it('should return false for unknown feature', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    const { result } = renderHook(() => useFeatureFlag('unknown-feature'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isEnabled).toBe(false)
  })

  it('should use feature defaults before API response', async () => {
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                createMockResponse({
                  features: [{ featureKey: 'feature-a', enabled: false }],
                })
              ),
            100
          )
        )
    )

    const { result } = renderHook(() => useFeatureFlag('feature-a'), {
      wrapper: createWrapper({
        appKey: 'test-key',
        featureDefaults: { 'feature-a': true },
      }),
    })

    // Before API response, should use default
    expect(result.current.isEnabled).toBe(true)
  })

  it('should refresh feature state', async () => {
    mockFetch
      .mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: false }],
        })
      )
      .mockResolvedValueOnce(
        createMockResponse({
          features: [{ featureKey: 'feature-a', enabled: true }],
        })
      )

    const { result } = renderHook(() => useFeatureFlag('feature-a'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isEnabled).toBe(false)

    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true)
    })
  })
})

describe('useFeatureOff', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should return inverted state', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [{ featureKey: 'feature-a', enabled: true }],
      })
    )

    const { result } = renderHook(() => useFeatureOff('feature-a'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // isEnabled in useFeatureOff means the feature is OFF
    expect(result.current.isEnabled).toBe(false)
    expect(result.current.isDisabled).toBe(true)
  })
})

describe('useFeatureGate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should evaluate all features with "all" requirement', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: true },
        ],
      })
    )

    const { result } = renderHook(
      () => useFeatureGate(['feature-a', 'feature-b'], 'all'),
      {
        wrapper: createWrapper(),
      }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isAllowed).toBe(true)
    expect(result.current.isBlocked).toBe(false)
  })

  it('should return false when not all features are enabled', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      })
    )

    const { result } = renderHook(
      () => useFeatureGate(['feature-a', 'feature-b'], 'all'),
      {
        wrapper: createWrapper(),
      }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isAllowed).toBe(false)
  })

  it('should evaluate with "any" requirement', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      })
    )

    const { result } = renderHook(
      () => useFeatureGate(['feature-a', 'feature-b'], 'any'),
      {
        wrapper: createWrapper(),
      }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.isAllowed).toBe(true)
  })
})

describe('useFeatures', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('should return all features', async () => {
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        features: [
          { featureKey: 'feature-a', enabled: true },
          { featureKey: 'feature-b', enabled: false },
        ],
      })
    )

    const { result } = renderHook(() => useFeatures(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    expect(result.current.features).toEqual({
      'feature-a': true,
      'feature-b': false,
    })
  })
})

describe('useIdentity setContext', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes setContext that updates client config claims', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ features: [] }))

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper({
        appKey: 'test-key',
        evaluationMode: 'local',
        claims: { role: 'user' },
      } as { appKey: string }),
    })

    await waitFor(() => {
      expect(result.current.setContext).toBeTypeOf('function')
    })

    await act(async () => {
      await result.current.setContext({ claims: { role: 'admin' } })
    })

    // Provider stays usable after setContext
    expect(result.current.isUpdating).toBe(false)
  })

  it('reevaluates useFeatureFlag after setContext claims under local mode', async () => {
    const claimsFlag = {
      featureKey: 'ClaimsFlag',
      filters: [
        {
          name: 'UserClaims',
          parameters: { Percentage: 100, Claim: 'role', Value: 'admin' },
        },
      ],
    }

    const body = JSON.stringify([claimsFlag])
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => body,
      json: async () => [claimsFlag],
      headers: { get: () => null },
    })

    function useFlagAndContext() {
      const flag = useFeatureFlag('ClaimsFlag')
      const identity = useIdentity()
      return { flag, identity }
    }

    const { result } = renderHook(() => useFlagAndContext(), {
      wrapper: createWrapper({
        appKey: 'test-key',
        evaluationMode: 'local',
        claims: { role: 'user' },
        refreshInterval: 0,
        enableLiveUpdates: false,
      } as { appKey: string }),
    })

    await waitFor(() => {
      expect(result.current.flag.isLoading).toBe(false)
      expect(result.current.flag.isEnabled).toBe(false)
    })

    await act(async () => {
      await result.current.identity.setContext({ claims: { role: 'admin' } })
    })

    await waitFor(() => {
      expect(result.current.flag.isEnabled).toBe(true)
    })
  })
})
