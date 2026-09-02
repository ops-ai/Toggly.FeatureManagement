import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { REFRESH_DEBOUNCE_MS } from '../src/ws-sync'

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = []
  url: string

  constructor(url: string) {
    super()
    this.url = url
    MockWebSocket.instances.push(this)
    queueMicrotask(() => this.emit('open'))
  }

  close(): void {
    this.emit('close')
  }

  /** Simulate a server message. */
  pushMessage(payload: string | object): void {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    this.emit('message', Buffer.from(text))
  }
}

vi.mock('ws', () => ({
  default: MockWebSocket,
}))

const { createTogglyClient, closeToggly } = await import('../src/client')

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function okResponse(body: unknown, revision?: string) {
  const headers = new Headers()
  if (revision) {
    headers.set('ETag', `"${revision}"`)
  }
  return {
    ok: true,
    status: 200,
    headers,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }
}

function alwaysOn(featureKey: string) {
  return {
    featureKey,
    filters: [{ name: 'AlwaysOn', parameters: {} }],
  }
}

function alwaysOff(featureKey: string) {
  return {
    featureKey,
    filters: [{ name: 'AlwaysOff', parameters: {} }],
  }
}

describe('client flags-updated pin path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instances = []
    closeToggly()
    vi.useFakeTimers()
  })

  afterEach(() => {
    closeToggly()
    vi.useRealTimers()
  })

  it('sets pending pin and omits If-None-Match on flags-updated refresh', async () => {
    mockFetch
      .mockResolvedValueOnce(
        okResponse([alwaysOn('feature-a')], 'old-rev'),
      )
      .mockResolvedValueOnce(
        okResponse([alwaysOff('feature-a')], 'new-rev'),
      )

    const client = createTogglyClient({
      appKey: 'test-app',
      environment: 'Production',
      refreshInterval: 0,
      enableStreaming: true,
      useEtag: true,
    })

    await client.init()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(client.state.etag).toBe('old-rev')

    // Allow WS constructor microtask to fire open
    await vi.runAllTimersAsync()
    expect(MockWebSocket.instances).toHaveLength(1)

    MockWebSocket.instances[0].pushMessage({
      type: 'flags-updated',
      etag: 'new-rev',
    })

    // Debounced refresh has not fired yet
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    // Flush the async refresh() started by the debounce timer
    await vi.runAllTimersAsync()

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const secondUrl = String(mockFetch.mock.calls[1][0])
    expect(secondUrl).toContain('rev=new-rev')
    const secondHeaders = mockFetch.mock.calls[1][1]?.headers as Record<string, string>
    expect(secondHeaders['If-None-Match']).toBeUndefined()
  })

  it('does not pin-refresh when flags-updated etag matches cache', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse([alwaysOn('feature-a')], 'same-rev'),
    )

    const client = createTogglyClient({
      appKey: 'test-app',
      environment: 'Production',
      refreshInterval: 0,
      enableStreaming: true,
      useEtag: true,
    })

    await client.init()
    await vi.runAllTimersAsync()
    expect(MockWebSocket.instances).toHaveLength(1)

    MockWebSocket.instances[0].pushMessage({
      type: 'flags-updated',
      etag: 'same-rev',
    })

    await vi.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)
    await vi.runAllTimersAsync()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(client.state.etag).toBe('same-rev')
  })
})
