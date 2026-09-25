import { decodeVariantValue } from '../src/decode-variant-value';

describe('decodeVariantValue', () => {
  it('returns null for nullish', () => {
    expect(decodeVariantValue(null)).toBeNull();
    expect(decodeVariantValue(undefined)).toBeNull();
  });

  it('returns value as T without a guard', () => {
    expect(decodeVariantValue<{ x: number }>({ x: 1 })).toEqual({ x: 1 });
    expect(decodeVariantValue<number>(42)).toBe(42);
  });

  it('soft-fails when a type guard rejects', () => {
    const isObj = (v: unknown): v is { x: number } =>
      typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number';
    expect(decodeVariantValue({ x: 1 }, isObj)).toEqual({ x: 1 });
    expect(decodeVariantValue(7, isObj)).toBeNull();
  });
});
