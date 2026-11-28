import { Toggly } from '../lib/toggly';
import { clearRegisteredContexts, type EntityGate } from '@ops-ai/toggly-hooks-types';
import { mockAnonymousIdentity } from './mock-identity';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

async function initWithDefs(defs: Record<string, unknown>): Promise<void> {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ defs }),
  });

  await Toggly.init({
    appKey: 'typed-value-key',
    environment: 'Production',
    persistCache: false,
    enableLiveUpdates: false,
    featureFlagsRefreshInterval: 0,
  });
}

async function initWithVariantDefs(defs: Record<string, unknown>): Promise<void> {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(defs),
  });

  await Toggly.init({
    appKey: 'typed-value-variant-key',
    environment: 'Production',
    enableVariants: true,
    persistCache: false,
    enableLiveUpdates: false,
    featureFlagsRefreshInterval: 0,
  });
}

describe('typed flag value getters (OPS-2102 / OPS-2105)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAnonymousIdentity('mock-uuid-typed-values');
    localStorage.clear();
    Toggly.cancelRefreshInterval();
    mockFetch.mockReset();
    clearRegisteredContexts();
  });

  afterEach(async () => {
    await Toggly.flushTelemetry();
    Toggly.cancelRefreshInterval();
  });

  describe('getStringValue', () => {
    it('decodes a matching envelope value', async () => {
      await initWithDefs({
        Theme: { enabled: true, valueType: 'string', value: 'dark' },
      });

      expect(Toggly.getStringValue('Theme')).toBe('dark');
    });

    it('returns null when the feature is disabled', async () => {
      await initWithDefs({
        Theme: { enabled: false, valueType: 'string', value: 'dark' },
      });

      expect(Toggly.getStringValue('Theme')).toBeNull();
    });

    it('soft-nulls when the declared valueType mismatches the getter', async () => {
      await initWithDefs({
        Theme: { enabled: true, valueType: 'number', value: 'dark' },
      });

      expect(Toggly.getStringValue('Theme')).toBeNull();
    });

    it('soft-decodes legacy envelopes missing valueType', async () => {
      await initWithDefs({
        Theme: { enabled: true, value: 'dark' },
      });

      expect(Toggly.getStringValue('Theme')).toBe('dark');
    });

    it('falls back to configurationValue when value is unset', async () => {
      await initWithDefs({
        Theme: { enabled: true, valueType: 'string', configurationValue: 'light' },
      });

      expect(Toggly.getStringValue('Theme')).toBe('light');
    });

    it('returns null for an unknown feature key', async () => {
      await initWithDefs({ Theme: { enabled: true, valueType: 'string', value: 'dark' } });

      expect(Toggly.getStringValue('Unknown')).toBeNull();
    });
  });

  describe('getNumberValue', () => {
    it('decodes a matching numeric envelope value', async () => {
      await initWithDefs({
        MaxItems: { enabled: true, valueType: 'number', value: 42 },
      });

      expect(Toggly.getNumberValue('MaxItems')).toBe(42);
    });

    it('decodes a numeric string payload', async () => {
      await initWithDefs({
        MaxItems: { enabled: true, valueType: 'number', value: '7' },
      });

      expect(Toggly.getNumberValue('MaxItems')).toBe(7);
    });

    it('soft-nulls on declared valueType mismatch', async () => {
      await initWithDefs({
        MaxItems: { enabled: true, valueType: 'string', value: 42 },
      });

      expect(Toggly.getNumberValue('MaxItems')).toBeNull();
    });

    it('returns null when the feature is disabled', async () => {
      await initWithDefs({
        MaxItems: { enabled: false, valueType: 'number', value: 42 },
      });

      expect(Toggly.getNumberValue('MaxItems')).toBeNull();
    });
  });

  describe('getJsonValue', () => {
    it('decodes a matching object payload', async () => {
      await initWithDefs({
        Checkout: { enabled: true, valueType: 'json', value: { steps: 3 } },
      });

      expect(Toggly.getJsonValue('Checkout')).toEqual({ steps: 3 });
    });

    it('parses a JSON string payload', async () => {
      await initWithDefs({
        Checkout: { enabled: true, valueType: 'json', value: '{"steps":3}' },
      });

      expect(Toggly.getJsonValue('Checkout')).toEqual({ steps: 3 });
    });

    it('soft-nulls invalid JSON strings', async () => {
      await initWithDefs({
        Checkout: { enabled: true, valueType: 'json', value: 'not-json' },
      });

      expect(Toggly.getJsonValue('Checkout')).toBeNull();
    });

    it('soft-nulls on declared valueType mismatch', async () => {
      await initWithDefs({
        Checkout: { enabled: true, valueType: 'string', value: { steps: 3 } },
      });

      expect(Toggly.getJsonValue('Checkout')).toBeNull();
    });
  });

  describe('getDateTimeValue', () => {
    it('decodes an ISO-8601 envelope value to a Date', async () => {
      const iso = '2026-11-28T12:00:00.000Z';
      await initWithDefs({
        SaleEndsAt: { enabled: true, valueType: 'datetime', value: iso },
      });

      const result = Toggly.getDateTimeValue('SaleEndsAt');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe(iso);
    });

    it('soft-nulls an unparseable date string', async () => {
      await initWithDefs({
        SaleEndsAt: { enabled: true, valueType: 'datetime', value: 'not-a-date' },
      });

      expect(Toggly.getDateTimeValue('SaleEndsAt')).toBeNull();
    });

    it('soft-nulls on declared valueType mismatch', async () => {
      await initWithDefs({
        SaleEndsAt: { enabled: true, valueType: 'string', value: '2026-11-28T12:00:00.000Z' },
      });

      expect(Toggly.getDateTimeValue('SaleEndsAt')).toBeNull();
    });
  });

  describe('entity-gated definitions', () => {
    const orderGate: EntityGate = {
      requirement: 'all',
      rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
    };

    it('returns null when the gate fails without a matching context', async () => {
      await initWithDefs({ OrderDiscount: orderGate });

      expect(Toggly.getStringValue('OrderDiscount')).toBeNull();
    });

    it('returns null once the gate passes, since gates carry no value', async () => {
      await initWithDefs({ OrderDiscount: orderGate });

      const context = { kind: 'Order', key: '1', attributes: { Color: 'brown' } };
      expect(Toggly.getStringValue('OrderDiscount', context)).toBeNull();
    });
  });

  describe('legacy variant-based flags (enableVariants)', () => {
    it('falls back to the assigned variant configurationValue with no declared type', async () => {
      await initWithVariantDefs({
        Promo: { enabled: true, variant: 'A', configurationValue: 'SAVE10' },
      });

      expect(Toggly.getStringValue('Promo')).toBe('SAVE10');
    });

    it('soft-nulls when the variant configurationValue has the wrong runtime shape', async () => {
      await initWithVariantDefs({
        Promo: { enabled: true, variant: 'A', configurationValue: 'SAVE10' },
      });

      expect(Toggly.getNumberValue('Promo')).toBeNull();
    });

    it('honors valueType from the variant envelope when flags are boolean-projected', async () => {
      await initWithVariantDefs({
        Promo: {
          enabled: true,
          variant: 'A',
          valueType: 'number',
          configurationValue: '42',
        },
      });

      expect(Toggly.getNumberValue('Promo')).toBe(42);
      expect(Toggly.getStringValue('Promo')).toBeNull();
    });

    it('returns null when no variant configurationValue is set', async () => {
      await initWithVariantDefs({
        Promo: { enabled: true, variant: 'A' },
      });

      expect(Toggly.getStringValue('Promo')).toBeNull();
    });
  });
});
