import { describe, it, expect, vi } from 'vitest'
import {
  dispatchLiveMessage,
  openLiveSocket,
  resolveWebSocketConstructor,
} from '../src/live-socket'

describe('resolveWebSocketConstructor', () => {
  it('prefers an explicit constructor', () => {
    class FakeWs {}
    expect(resolveWebSocketConstructor(FakeWs as never)).toBe(FakeWs)
  })

  it('falls back to globalThis.WebSocket when present', () => {
    class GlobalWs {}
    const previous = (globalThis as { WebSocket?: unknown }).WebSocket
    ;(globalThis as { WebSocket?: unknown }).WebSocket = GlobalWs
    try {
      expect(resolveWebSocketConstructor()).toBe(GlobalWs)
    } finally {
      ;(globalThis as { WebSocket?: unknown }).WebSocket = previous
    }
  })
})

describe('openLiveSocket', () => {
  it('wires browser-style sockets', () => {
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    }

    class Capturing {
      static instance: Capturing
      onopen: ((ev: Event) => void) | null = null
      onmessage: ((ev: MessageEvent) => void) | null = null
      onclose: ((ev: CloseEvent) => void) | null = null
      onerror: ((ev: Event) => void) | null = null
      close = vi.fn()
      constructor(url: string) {
        Capturing.instance = this
        void url
      }
    }

    const live = openLiveSocket('wss://example.test', Capturing as never, handlers)
    Capturing.instance.onopen?.(new Event('open'))
    Capturing.instance.onmessage?.({ data: 'flags-updated' } as MessageEvent)
    Capturing.instance.onclose?.(new Event('close') as unknown as CloseEvent)
    expect(handlers.onOpen).toHaveBeenCalled()
    expect(handlers.onMessage).toHaveBeenCalledWith('flags-updated')
    expect(handlers.onClose).toHaveBeenCalled()
    live.close()
    expect(Capturing.instance.close).toHaveBeenCalled()
    expect(Capturing.instance.onclose).toBeNull()
  })

  it('detaches EventEmitter listeners on close so late close events are ignored', () => {
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    }

    class EmitterWs {
      static instance: EmitterWs
      listeners = new Map<string, Array<(...args: unknown[]) => void>>()
      on(event: string, listener: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? []
        list.push(listener)
        this.listeners.set(event, list)
      }
      emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) {
          listener(...args)
        }
      }
      removeAllListeners = vi.fn(() => {
        this.listeners.clear()
      })
      close = vi.fn()
      constructor(url: string) {
        EmitterWs.instance = this
        void url
      }
    }

    const live = openLiveSocket('wss://example.test', EmitterWs as never, handlers)
    live.close()
    expect(EmitterWs.instance.removeAllListeners).toHaveBeenCalled()
    EmitterWs.instance.emit('close')
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('wires EventEmitter-style ws package sockets', () => {
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    }

    class EmitterWs {
      static instance: EmitterWs
      listeners = new Map<string, Array<(...args: unknown[]) => void>>()
      on(event: string, listener: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? []
        list.push(listener)
        this.listeners.set(event, list)
      }
      emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) {
          listener(...args)
        }
      }
      removeAllListeners = vi.fn()
      close = vi.fn()
      constructor(url: string) {
        EmitterWs.instance = this
        void url
      }
    }

    const live = openLiveSocket('wss://example.test', EmitterWs as never, handlers)
    EmitterWs.instance.emit('open')
    EmitterWs.instance.emit('message', Buffer.from('update'))
    EmitterWs.instance.emit('close')
    expect(handlers.onOpen).toHaveBeenCalled()
    expect(handlers.onMessage).toHaveBeenCalledWith('update')
    expect(handlers.onClose).toHaveBeenCalled()
    live.close()
    expect(EmitterWs.instance.close).toHaveBeenCalled()
  })

  it('prefers EventEmitter when both on() and onmessage exist (like ws)', () => {
    const handlers = {
      onOpen: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
    }

    class DualApiWs {
      static instance: DualApiWs
      listeners = new Map<string, Array<(...args: unknown[]) => void>>()
      onmessage: ((ev: MessageEvent) => void) | null = null
      on(event: string, listener: (...args: unknown[]) => void) {
        const list = this.listeners.get(event) ?? []
        list.push(listener)
        this.listeners.set(event, list)
      }
      emit(event: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(event) ?? []) {
          listener(...args)
        }
      }
      close = vi.fn()
      constructor(url: string) {
        DualApiWs.instance = this
        void url
      }
    }

    openLiveSocket('wss://example.test', DualApiWs as never, handlers)
    DualApiWs.instance.emit('open')
    DualApiWs.instance.emit('message', 'flags-updated')
    // Browser-style assignment must not be the active path
    DualApiWs.instance.onmessage?.({ data: 'ignored' } as MessageEvent)
    expect(handlers.onOpen).toHaveBeenCalledTimes(1)
    expect(handlers.onMessage).toHaveBeenCalledWith('flags-updated')
    expect(handlers.onMessage).not.toHaveBeenCalledWith('ignored')
  })
})

describe('dispatchLiveMessage', () => {
  it('routes plain update tokens', () => {
    const onPlainUpdate = vi.fn()
    dispatchLiveMessage('update', {
      onPlainUpdate,
      onSync: vi.fn(),
      onUpdate: vi.fn(),
    })
    expect(onPlainUpdate).toHaveBeenCalled()
  })

  it('routes sync and flags-updated JSON', () => {
    const onSync = vi.fn()
    const onUpdate = vi.fn()
    dispatchLiveMessage(JSON.stringify({ type: 'sync', etag: 'abc' }), {
      onPlainUpdate: vi.fn(),
      onSync,
      onUpdate,
    })
    dispatchLiveMessage(JSON.stringify({ type: 'flags-updated', etag: 'def' }), {
      onPlainUpdate: vi.fn(),
      onSync,
      onUpdate,
    })
    expect(onSync).toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalled()
  })
})
