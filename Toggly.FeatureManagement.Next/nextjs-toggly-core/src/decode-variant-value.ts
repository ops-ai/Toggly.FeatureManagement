/**
 * Soft-decode a variant configuration value as `T`.
 * Missing/null → null; with `isT` → null when guard fails; otherwise value as T.
 */
export function decodeVariantValue<T = unknown>(
  value: unknown,
  isT?: (v: unknown) => v is T,
): T | null {
  if (value === null || value === undefined) return null
  if (isT) return isT(value) ? value : null
  return value as T
}
