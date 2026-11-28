/**
 * Typed flag value getters (OPS-2102 / OPS-2105): getStringValue,
 * getNumberValue, getJsonValue, getDateTimeValue.
 */
import Toggly from './toggly.service';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function mockDefsResponse(defs: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ defs }),
    text: () => Promise.resolve(JSON.stringify({ defs })),
  });
}

describe('typed flag value getters (OPS-2102 / OPS-2105)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getStringValue', () => {
    it('decodes a matching envelope value', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', value: 'dark' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Theme')).toBe('dark');
    });

    it('returns null when the feature is disabled', async () => {
      mockDefsResponse({ Theme: { enabled: false, valueType: 'string', value: 'dark' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Theme')).toBeNull();
    });

    it('soft-nulls when the declared valueType mismatches the getter', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'number', value: 'dark' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Theme')).toBeNull();
    });

    it('soft-decodes legacy envelopes missing valueType', async () => {
      mockDefsResponse({ Theme: { enabled: true, value: 'dark' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Theme')).toBe('dark');
    });

    it('falls back to configurationValue when value is unset', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', configurationValue: 'light' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Theme')).toBe('light');
    });

    it('returns null for an unknown feature key', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', value: 'dark' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Unknown')).toBeNull();
    });
  });

  describe('getNumberValue', () => {
    it('decodes a matching numeric envelope value', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'number', value: 42 } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getNumberValue('MaxItems')).toBe(42);
    });

    it('decodes a numeric string payload', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'number', value: '7' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getNumberValue('MaxItems')).toBe(7);
    });

    it('soft-nulls on declared valueType mismatch', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'string', value: 42 } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getNumberValue('MaxItems')).toBeNull();
    });
  });

  describe('getJsonValue', () => {
    it('decodes a matching object payload', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: { steps: 3 } } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getJsonValue('Checkout')).toEqual({ steps: 3 });
    });

    it('parses a JSON string payload', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: '{"steps":3}' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getJsonValue('Checkout')).toEqual({ steps: 3 });
    });

    it('soft-nulls invalid JSON strings', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: 'not-json' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getJsonValue('Checkout')).toBeNull();
    });
  });

  describe('getDateTimeValue', () => {
    it('decodes an ISO-8601 envelope value to a Date', async () => {
      const iso = '2026-11-28T12:00:00.000Z';
      mockDefsResponse({ SaleEndsAt: { enabled: true, valueType: 'datetime', value: iso } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      const result = await service.getDateTimeValue('SaleEndsAt');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe(iso);
    });

    it('soft-nulls an unparseable date string', async () => {
      mockDefsResponse({ SaleEndsAt: { enabled: true, valueType: 'datetime', value: 'not-a-date' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getDateTimeValue('SaleEndsAt')).toBeNull();
    });
  });

  describe('entity-gated definitions', () => {
    const orderGate = {
      requirement: 'all',
      rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
    };

    it('returns null when the gate fails without a matching context', async () => {
      mockDefsResponse({ OrderDiscount: orderGate });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      expect(await service.getStringValue('OrderDiscount')).toBeNull();
    });

    it('returns null once the gate passes, since gates carry no value', async () => {
      mockDefsResponse({ OrderDiscount: orderGate });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production', enableLiveUpdates: false,
      });

      const context = { kind: 'Order', key: '1', attributes: { Color: 'brown' } };
      expect(await service.getStringValue('OrderDiscount', context)).toBeNull();
    });
  });

  describe('legacy variant-based flags (enableVariants)', () => {
    it('falls back to the assigned variant configurationValue with no declared type', async () => {
      mockDefsResponse({ Promo: { enabled: true, variant: 'A', configurationValue: 'SAVE10' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production',
        enableVariants: true, enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Promo')).toBe('SAVE10');
    });

    it('returns null when no variant configurationValue is set', async () => {
      mockDefsResponse({ Promo: { enabled: true, variant: 'A' } });
      const service = new Toggly({
        enableTelemetry: false, appKey: 'typed-key', environment: 'Production',
        enableVariants: true, enableLiveUpdates: false,
      });

      expect(await service.getStringValue('Promo')).toBeNull();
    });
  });
});
