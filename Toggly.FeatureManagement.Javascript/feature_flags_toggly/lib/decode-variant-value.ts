/**
 * Soft-decode a variant configuration value as `T`.
 *
 * - Missing / null / undefined → `null`
 * - With `isT` guard → `null` when the guard fails
 * - Without guard → value as `T` (compile-time only; matches industry JSON SDK practice)
 */
export function decodeVariantValue<T = unknown>(
  value: unknown,
  isT?: (v: unknown) => v is T,
): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (isT) {
    return isT(value) ? value : null;
  }
  return value as T;
}
