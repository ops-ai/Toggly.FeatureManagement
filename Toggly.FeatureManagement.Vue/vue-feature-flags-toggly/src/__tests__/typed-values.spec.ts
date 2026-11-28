/**
 * Typed flag value getters (OPS-2102 / OPS-2105): getStringValue,
 * getNumberValue, getJsonValue, getDateTimeValue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Toggly } from '../plugins/toggly.service'
import { createMockFetchResponse } from './test-helpers'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockDefsResponse(defs: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce(createMockFetchResponse({ defs }, 200, 'OK'))
}

function newService(options: Record<string, unknown> = {}) {
  return new Toggly().init({
    appKey: 'typed-value-app',
    environment: 'Production',
    baseURI: 'https://definitions.example.test',
    enableLiveUpdates: false,
    enableTelemetry: false,
    persistCache: false,
    verifySignatures: false,
    ...options,
  })
}

describe('typed flag value getters (OPS-2102 / OPS-2105)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getStringValue', () => {
    it('decodes a matching envelope value', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', value: 'dark' } })
      const service = newService()

      expect(await service.getStringValue('Theme')).toBe('dark')
      service.dispose()
    })

    it.each([
      {
        name: 'disabled feature',
        defs: { Theme: { enabled: false, valueType: 'string', value: 'dark' } },
        key: 'Theme',
      },
      {
        name: 'declared valueType mismatch',
        defs: { Theme: { enabled: true, valueType: 'number', value: 'dark' } },
        key: 'Theme',
      },
      {
        name: 'unknown feature key',
        defs: { Theme: { enabled: true, valueType: 'string', value: 'dark' } },
        key: 'Unknown',
      },
    ])('returns null for $name', async ({ defs, key }) => {
      mockDefsResponse(defs)
      const service = newService()

      expect(await service.getStringValue(key)).toBeNull()
      service.dispose()
    })

    it('soft-decodes legacy envelopes missing valueType', async () => {
      mockDefsResponse({ Theme: { enabled: true, value: 'dark' } })
      const service = newService()

      expect(await service.getStringValue('Theme')).toBe('dark')
      service.dispose()
    })

    it('falls back to configurationValue when value is unset', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', configurationValue: 'light' } })
      const service = newService()

      expect(await service.getStringValue('Theme')).toBe('light')
      service.dispose()
    })
  })

  describe('getNumberValue', () => {
    it('decodes a matching numeric envelope value', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'number', value: 42 } })
      const service = newService()

      expect(await service.getNumberValue('MaxItems')).toBe(42)
      service.dispose()
    })

    it('decodes a numeric string payload', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'number', value: '7' } })
      const service = newService()

      expect(await service.getNumberValue('MaxItems')).toBe(7)
      service.dispose()
    })

    it('soft-nulls on declared valueType mismatch', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'string', value: 42 } })
      const service = newService()

      expect(await service.getNumberValue('MaxItems')).toBeNull()
      service.dispose()
    })
  })

  describe('getJsonValue', () => {
    it('decodes a matching object payload', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: { steps: 3 } } })
      const service = newService()

      expect(await service.getJsonValue('Checkout')).toEqual({ steps: 3 })
      service.dispose()
    })

    it('parses a JSON string payload', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: '{"steps":3}' } })
      const service = newService()

      expect(await service.getJsonValue('Checkout')).toEqual({ steps: 3 })
      service.dispose()
    })

    it('soft-nulls invalid JSON strings', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: 'not-json' } })
      const service = newService()

      expect(await service.getJsonValue('Checkout')).toBeNull()
      service.dispose()
    })
  })

  describe('getDateTimeValue', () => {
    it('decodes an ISO-8601 envelope value to a Date', async () => {
      const iso = '2026-11-28T12:00:00.000Z'
      mockDefsResponse({ SaleEndsAt: { enabled: true, valueType: 'datetime', value: iso } })
      const service = newService()

      const result = await service.getDateTimeValue('SaleEndsAt')
      expect(result).toBeInstanceOf(Date)
      expect(result!.toISOString()).toBe(iso)
      service.dispose()
    })

    it('soft-nulls an unparseable date string', async () => {
      mockDefsResponse({ SaleEndsAt: { enabled: true, valueType: 'datetime', value: 'not-a-date' } })
      const service = newService()

      expect(await service.getDateTimeValue('SaleEndsAt')).toBeNull()
      service.dispose()
    })
  })

  describe('entity-gated definitions', () => {
    const orderGate = {
      requirement: 'all',
      rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
    }

    it('returns null when the gate fails without a matching context', async () => {
      mockDefsResponse({ OrderDiscount: orderGate })
      const service = newService()

      expect(await service.getStringValue('OrderDiscount')).toBeNull()
      service.dispose()
    })

    it('returns null once the gate passes, since gates carry no value', async () => {
      mockDefsResponse({ OrderDiscount: orderGate })
      const service = newService()

      const context = { kind: 'Order', key: '1', attributes: { Color: 'brown' } }
      expect(await service.getStringValue('OrderDiscount', context)).toBeNull()
      service.dispose()
    })
  })

  describe('legacy variant-based flags (enableVariants)', () => {
    it('falls back to the assigned variant configurationValue with no declared type', async () => {
      mockDefsResponse({ Promo: { enabled: true, variant: 'A', configurationValue: 'SAVE10' } })
      const service = newService({ enableVariants: true })

      expect(await service.getStringValue('Promo')).toBe('SAVE10')
      service.dispose()
    })

    it('returns null when no variant configurationValue is set', async () => {
      mockDefsResponse({ Promo: { enabled: true, variant: 'A' } })
      const service = newService({ enableVariants: true })

      expect(await service.getStringValue('Promo')).toBeNull()
      service.dispose()
    })
  })
})
