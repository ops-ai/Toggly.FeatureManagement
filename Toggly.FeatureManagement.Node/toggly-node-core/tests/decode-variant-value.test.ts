import { describe, it, expect } from 'vitest'
import { decodeVariantValue } from '../src/decode-variant-value'

describe('decodeVariantValue', () => {
  it('returns null for missing / nullish values', () => {
    expect(decodeVariantValue(null)).toBeNull()
    expect(decodeVariantValue(undefined)).toBeNull()
  })

  it('returns an object as T without a guard', () => {
    expect(decodeVariantValue<{ x: number }>({ x: 1 })).toEqual({ x: 1 })
  })

  it('returns a scalar as T without a guard', () => {
    expect(decodeVariantValue<number>(42)).toBe(42)
    expect(decodeVariantValue<string>('blue')).toBe('blue')
  })

  it('soft-fails (null) when a type guard rejects', () => {
    const isCheckout = (v: unknown): v is { x: number } =>
      typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number'

    expect(decodeVariantValue({ x: 1 }, isCheckout)).toEqual({ x: 1 })
    expect(decodeVariantValue(7, isCheckout)).toBeNull()
    expect(decodeVariantValue(null, isCheckout)).toBeNull()
  })
})
