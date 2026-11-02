/**
 * Flag evaluation against the Toggly evaluated-signed HTTP API contract
 * (mocked responses with realistic payloads).
 *
 * Exercises public main-process entry points: initToggly / isFeatureOn /
 * isFeatureOff / evaluateFeatureGate / getFlags — not stubbed evaluation helpers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initToggly,
  closeToggly,
  isFeatureOn,
  isFeatureOff,
  evaluateFeatureGate,
  getToggly,
  __resetTogglyForTests,
} from '../src/main/client.js'

vi.mock('ws', () => {
  class MockWebSocket {
    on = vi.fn()
    close = vi.fn()
    removeAllListeners = vi.fn()
  }
  return { default: MockWebSocket }
})

function mockResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      get: (name: string) =>
        headers[name] ?? headers[name.toLowerCase()] ?? null,
    },
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response
}

describe('Electron evaluated-signed API contract evaluation', () => {
  let userDataPath: string

  beforeEach(async () => {
    __resetTogglyForTests()
    userDataPath = await mkdtemp(join(tmpdir(), 'toggly-electron-contract-'))
  })

  afterEach(async () => {
    closeToggly()
    __resetTogglyForTests()
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('fetches evaluated-signed { defs } and evaluates flags through public APIs', async () => {
    // Frontend App Key path returns a boolean map under `defs` (evaluated-signed).
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        defs: {
          FlagOn: true,
          FlagOff: false,
          MissingElsewhere: true,
        },
      }),
    )

    await initToggly({
      appKey: 'contract-app',
      environment: 'Production',
      identity: 'alice',
      groups: ['beta'],
      claims: { plan: 'pro' },
      userDataPath,
      baseURI: 'https://definitions.example.test',
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableTelemetry: false,
      verifySignatures: false,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const calledUrl = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(calledUrl.origin).toBe('https://definitions.example.test')
    expect(calledUrl.pathname).toBe('/evaluated-signed/contract-app/Production')
    expect(calledUrl.pathname).not.toContain('/definitions-signed/')
    expect(calledUrl.searchParams.get('u')).toBe('alice')
    expect(calledUrl.searchParams.getAll('g')).toEqual(['beta'])
    expect(calledUrl.searchParams.get('claim.plan')).toBe('pro')
    expect(fetchImpl.mock.calls[0][1]?.cache).toBe('no-store')

    const client = getToggly()
    expect(client).not.toBeNull()
    expect(client!.getFlags()).toEqual({
      FlagOn: true,
      FlagOff: false,
      MissingElsewhere: true,
    })
    expect(isFeatureOn('FlagOn')).toBe(true)
    expect(isFeatureOff('FlagOff')).toBe(true)
    expect(isFeatureOn('Absent')).toBe(false)
    expect(evaluateFeatureGate(['FlagOn', 'FlagOff'], 'any')).toBe(true)
    expect(evaluateFeatureGate(['FlagOn', 'FlagOff'], 'all')).toBe(false)
  })

  it('evaluates entity-gated defs from the evaluated-signed envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(200, {
        defs: {
          AlwaysOn: true,
          EntityGate: {
            requirement: 'all',
            rules: [
              {
                property: 'plan',
                op: 'eq',
                value: 'pro',
                type: 'string',
              },
            ],
          },
        },
      }),
    )

    await initToggly({
      appKey: 'contract-app',
      environment: 'Production',
      identity: 'bob',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableTelemetry: false,
      verifySignatures: false,
    })

    expect(isFeatureOn('AlwaysOn')).toBe(true)
    expect(isFeatureOn('EntityGate')).toBe(false)
    expect(
      isFeatureOn('EntityGate', {
        kind: 'Account',
        key: '1',
        attributes: { plan: 'pro' },
      }),
    ).toBe(true)
  })

  it('keeps flagDefaults when the evaluated-signed body is empty', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse(200, { defs: {} }))

    await initToggly({
      appKey: 'contract-app',
      environment: 'Production',
      userDataPath,
      fetch: fetchImpl,
      enableLiveUpdates: false,
      enableTelemetry: false,
      verifySignatures: false,
      flagDefaults: { Fallback: true },
    })

    // Empty evaluated body leaves no keys in getFlags; missing keys still honor
    // flagDefaults through the public isFeatureOn path.
    expect(getToggly()!.getFlags()).toEqual({})
    expect(isFeatureOn('Fallback')).toBe(true)
    expect(isFeatureOn('Absent')).toBe(false)
  })
})
