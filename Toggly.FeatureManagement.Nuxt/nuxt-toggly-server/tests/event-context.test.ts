import { describe, expect, it, beforeEach } from 'vitest'
import type { H3Event } from 'h3'
import {
  configureEventEvalContext,
  getCachedEventEvalContext,
  hasConfiguredEventEvalProviders,
  resetEventEvalContextProviders,
  resolveSyncEventEvalContext,
} from '../src/event-context'

function createMockEvent(headers: Record<string, string> = {}): H3Event {
  return {
    node: { req: { headers } },
    context: {},
  } as H3Event
}

describe('event-context sync resolution', () => {
  beforeEach(() => {
    resetEventEvalContextProviders()
  })

  it('hasConfiguredEventEvalProviders reflects registration', () => {
    expect(hasConfiguredEventEvalProviders()).toBe(false)
    configureEventEvalContext({ getIdentity: () => 'alice' })
    expect(hasConfiguredEventEvalProviders()).toBe(true)
  })

  it('resolveSyncEventEvalContext caches sync provider output', () => {
    configureEventEvalContext({
      getIdentity: () => 'alice',
      getClaims: () => ({ role: 'admin' }),
    })
    const event = createMockEvent()
    const options = resolveSyncEventEvalContext(event)
    expect(options?.identity).toBe('alice')
    expect(options?.claims).toEqual({ role: 'admin' })
    expect(getCachedEventEvalContext(event)).toEqual(options)
  })

  it('resolveSyncEventEvalContext returns undefined for async providers', () => {
    configureEventEvalContext({
      getIdentity: async () => 'alice',
    })
    const event = createMockEvent()
    expect(resolveSyncEventEvalContext(event)).toBeUndefined()
    expect(getCachedEventEvalContext(event)).toBeUndefined()
  })

  it('resolveSyncEventEvalContext returns undefined when only getGroups is async', () => {
    configureEventEvalContext({
      getIdentity: () => 'alice',
      getGroups: async () => ['beta'],
    })
    expect(resolveSyncEventEvalContext(createMockEvent())).toBeUndefined()
  })

  it('absorbs rejected async providers without unhandled rejections', async () => {
    let unhandled = false
    const onUnhandled = () => {
      unhandled = true
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      configureEventEvalContext({
        getIdentity: () => Promise.reject(new Error('async-only')),
      })
      expect(resolveSyncEventEvalContext(createMockEvent())).toBeUndefined()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(unhandled).toBe(false)
    } finally {
      process.removeListener('unhandledRejection', onUnhandled)
    }
  })
})
