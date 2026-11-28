/**
 * Typed flag value getters (OPS-2102 / OPS-2105): getStringValue,
 * getNumberValue, getJsonValue, getDateTimeValue.
 */
import { TestBed } from '@angular/core/testing'
import { NgxFeatureFlagsTogglyModule } from './ngx-feature-flags-toggly.module'
import { TogglyService } from './toggly.service'

function mockEvaluatedResponse(payload: unknown): jasmine.Spy {
  return spyOn(globalThis, 'fetch').and.resolveTo({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as any)
}

function configureService(options: Record<string, unknown> = {}): TogglyService {
  TestBed.configureTestingModule({
    imports: [
      NgxFeatureFlagsTogglyModule.forRoot({
        appKey: 'typed-value-app',
        environment: 'Production',
        baseURI: 'https://definitions.example.test',
        enableTelemetry: false,
        persistCache: false,
        verifySignatures: false,
        ...options,
      }),
    ],
  })
  return TestBed.inject(TogglyService)
}

describe('typed flag value getters (OPS-2102 / OPS-2105)', () => {
  beforeEach(() => {
    localStorage.clear()
    spyOn(console, 'warn').and.stub()
    spyOn(console, 'error').and.stub()
  })

  afterEach(() => {
    TestBed.resetTestingModule()
  })

  describe('getStringValue', () => {
    it('decodes a matching envelope value', async () => {
      mockEvaluatedResponse({
        defs: { Theme: { enabled: true, valueType: 'string', value: 'dark' } },
      })
      const service = configureService()

      expect(await service.getStringValue('Theme')).toBe('dark')
    })

    it('returns null when the feature is disabled', async () => {
      mockEvaluatedResponse({
        defs: { Theme: { enabled: false, valueType: 'string', value: 'dark' } },
      })
      const service = configureService()

      expect(await service.getStringValue('Theme')).toBeNull()
    })

    it('soft-nulls when the declared valueType mismatches the getter', async () => {
      mockEvaluatedResponse({
        defs: { Theme: { enabled: true, valueType: 'number', value: 'dark' } },
      })
      const service = configureService()

      expect(await service.getStringValue('Theme')).toBeNull()
    })

    it('soft-decodes legacy envelopes missing valueType', async () => {
      mockEvaluatedResponse({ defs: { Theme: { enabled: true, value: 'dark' } } })
      const service = configureService()

      expect(await service.getStringValue('Theme')).toBe('dark')
    })

    it('falls back to configurationValue when value is unset', async () => {
      mockEvaluatedResponse({
        defs: { Theme: { enabled: true, valueType: 'string', configurationValue: 'light' } },
      })
      const service = configureService()

      expect(await service.getStringValue('Theme')).toBe('light')
    })

    it('returns null for an unknown feature key', async () => {
      mockEvaluatedResponse({
        defs: { Theme: { enabled: true, valueType: 'string', value: 'dark' } },
      })
      const service = configureService()

      expect(await service.getStringValue('Unknown')).toBeNull()
    })
  })

  describe('getNumberValue', () => {
    it('decodes a matching numeric envelope value', async () => {
      mockEvaluatedResponse({
        defs: { MaxItems: { enabled: true, valueType: 'number', value: 42 } },
      })
      const service = configureService()

      expect(await service.getNumberValue('MaxItems')).toBe(42)
    })

    it('decodes a numeric string payload', async () => {
      mockEvaluatedResponse({
        defs: { MaxItems: { enabled: true, valueType: 'number', value: '7' } },
      })
      const service = configureService()

      expect(await service.getNumberValue('MaxItems')).toBe(7)
    })

    it('soft-nulls on declared valueType mismatch', async () => {
      mockEvaluatedResponse({
        defs: { MaxItems: { enabled: true, valueType: 'string', value: 42 } },
      })
      const service = configureService()

      expect(await service.getNumberValue('MaxItems')).toBeNull()
    })
  })

  describe('getJsonValue', () => {
    it('decodes a matching object payload', async () => {
      mockEvaluatedResponse({
        defs: { Checkout: { enabled: true, valueType: 'json', value: { steps: 3 } } },
      })
      const service = configureService()

      expect(await service.getJsonValue('Checkout')).toEqual({ steps: 3 })
    })

    it('parses a JSON string payload', async () => {
      mockEvaluatedResponse({
        defs: { Checkout: { enabled: true, valueType: 'json', value: '{"steps":3}' } },
      })
      const service = configureService()

      expect(await service.getJsonValue('Checkout')).toEqual({ steps: 3 })
    })

    it('soft-nulls invalid JSON strings', async () => {
      mockEvaluatedResponse({
        defs: { Checkout: { enabled: true, valueType: 'json', value: 'not-json' } },
      })
      const service = configureService()

      expect(await service.getJsonValue('Checkout')).toBeNull()
    })
  })

  describe('getDateTimeValue', () => {
    it('decodes an ISO-8601 envelope value to a Date', async () => {
      const iso = '2026-11-28T12:00:00.000Z'
      mockEvaluatedResponse({
        defs: { SaleEndsAt: { enabled: true, valueType: 'datetime', value: iso } },
      })
      const service = configureService()

      const result = await service.getDateTimeValue('SaleEndsAt')
      expect(result).toBeInstanceOf(Date)
      expect(result!.toISOString()).toBe(iso)
    })

    it('soft-nulls an unparseable date string', async () => {
      mockEvaluatedResponse({
        defs: { SaleEndsAt: { enabled: true, valueType: 'datetime', value: 'not-a-date' } },
      })
      const service = configureService()

      expect(await service.getDateTimeValue('SaleEndsAt')).toBeNull()
    })
  })

  describe('entity-gated definitions', () => {
    const orderGate = {
      requirement: 'all',
      rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
    }

    it('returns null when the gate fails without a matching context', async () => {
      mockEvaluatedResponse({ defs: { OrderDiscount: orderGate } })
      const service = configureService()

      expect(await service.getStringValue('OrderDiscount')).toBeNull()
    })

    it('returns null once the gate passes, since gates carry no value', async () => {
      mockEvaluatedResponse({ defs: { OrderDiscount: orderGate } })
      const service = configureService()

      const context = { kind: 'Order', key: '1', attributes: { Color: 'brown' } }
      expect(await service.getStringValue('OrderDiscount', context)).toBeNull()
    })
  })

  describe('legacy variant-based flags (enableVariants)', () => {
    it('falls back to the assigned variant configurationValue with no declared type', async () => {
      mockEvaluatedResponse({
        defs: { Promo: { enabled: true, variant: 'A', configurationValue: 'SAVE10' } },
      })
      const service = configureService({ enableVariants: true })

      expect(await service.getStringValue('Promo')).toBe('SAVE10')
    })

    it('returns null when no variant configurationValue is set', async () => {
      mockEvaluatedResponse({ defs: { Promo: { enabled: true, variant: 'A' } } })
      const service = configureService({ enableVariants: true })

      expect(await service.getStringValue('Promo')).toBeNull()
    })
  })
})
