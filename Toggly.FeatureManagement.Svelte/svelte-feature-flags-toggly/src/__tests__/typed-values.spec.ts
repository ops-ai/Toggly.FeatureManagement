/**
 * Typed flag value getters (OPS-2102 / OPS-2105): getStringValue,
 * getNumberValue, getJsonValue, getDateTimeValue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Toggly } from '../services/toggly.service';

function mockDefsResponse(defs: Record<string, unknown>): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ defs }),
    text: () => Promise.resolve(JSON.stringify({ defs })),
  } as Response);
}

describe('typed flag value getters (OPS-2102 / OPS-2105)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStringValue', () => {
    it('decodes a matching envelope value', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', value: 'dark' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('Theme')).toBe('dark');
    });

    it('returns null when the feature is disabled', async () => {
      mockDefsResponse({ Theme: { enabled: false, valueType: 'string', value: 'dark' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('Theme')).toBeNull();
    });

    it('soft-nulls when the declared valueType mismatches the getter', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'number', value: 'dark' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('Theme')).toBeNull();
    });

    it('soft-decodes legacy envelopes missing valueType', async () => {
      mockDefsResponse({ Theme: { enabled: true, value: 'dark' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('Theme')).toBe('dark');
    });

    it('falls back to configurationValue when value is unset', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', configurationValue: 'light' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('Theme')).toBe('light');
    });

    it('returns null for an unknown feature key', async () => {
      mockDefsResponse({ Theme: { enabled: true, valueType: 'string', value: 'dark' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('Unknown')).toBeNull();
    });
  });

  describe('getNumberValue', () => {
    it('decodes a matching numeric envelope value', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'number', value: 42 } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getNumberValue('MaxItems')).toBe(42);
    });

    it('decodes a numeric string payload', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'number', value: '7' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getNumberValue('MaxItems')).toBe(7);
    });

    it('soft-nulls on declared valueType mismatch', async () => {
      mockDefsResponse({ MaxItems: { enabled: true, valueType: 'string', value: 42 } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getNumberValue('MaxItems')).toBeNull();
    });
  });

  describe('getJsonValue', () => {
    it('decodes a matching object payload', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: { steps: 3 } } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getJsonValue('Checkout')).toEqual({ steps: 3 });
    });

    it('parses a JSON string payload', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: '{"steps":3}' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getJsonValue('Checkout')).toEqual({ steps: 3 });
    });

    it('soft-nulls invalid JSON strings', async () => {
      mockDefsResponse({ Checkout: { enabled: true, valueType: 'json', value: 'not-json' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getJsonValue('Checkout')).toBeNull();
    });
  });

  describe('getDateTimeValue', () => {
    it('decodes an ISO-8601 envelope value to a Date', async () => {
      const iso = '2026-11-28T12:00:00.000Z';
      mockDefsResponse({ SaleEndsAt: { enabled: true, valueType: 'datetime', value: iso } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      const result = await toggly.getDateTimeValue('SaleEndsAt');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe(iso);
    });

    it('soft-nulls an unparseable date string', async () => {
      mockDefsResponse({ SaleEndsAt: { enabled: true, valueType: 'datetime', value: 'not-a-date' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getDateTimeValue('SaleEndsAt')).toBeNull();
    });
  });

  describe('entity-gated definitions', () => {
    const orderGate = {
      requirement: 'all',
      rules: [{ property: 'Color', op: 'eq', value: 'brown' }],
    };

    it('returns null when the gate fails without a matching context', async () => {
      mockDefsResponse({ OrderDiscount: orderGate });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      expect(await toggly.getStringValue('OrderDiscount')).toBeNull();
    });

    it('returns null once the gate passes, since gates carry no value', async () => {
      mockDefsResponse({ OrderDiscount: orderGate });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production',
      });

      const context = { kind: 'Order', key: '1', attributes: { Color: 'brown' } };
      expect(await toggly.getStringValue('OrderDiscount', context)).toBeNull();
    });
  });

  describe('legacy variant-based flags (enableVariants)', () => {
    it('falls back to the assigned variant configurationValue with no declared type', async () => {
      mockDefsResponse({ Promo: { enabled: true, variant: 'A', configurationValue: 'SAVE10' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production', enableVariants: true,
      });

      expect(await toggly.getStringValue('Promo')).toBe('SAVE10');
    });

    it('returns null when no variant configurationValue is set', async () => {
      mockDefsResponse({ Promo: { enabled: true, variant: 'A' } });
      const toggly = new Toggly({
        appKey: 'typed-key', enableTelemetry: false, environment: 'Production', enableVariants: true,
      });

      expect(await toggly.getStringValue('Promo')).toBeNull();
    });
  });
});
