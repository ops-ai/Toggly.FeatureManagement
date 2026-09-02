import { createHash } from 'node:crypto'

/**
 * Sticky percentile bucket in [0, 100) matching Definitions
 * (`computePercentile`): SHA-256 of `${featureKey}\n${userId}`,
 * little-endian first 4 bytes as uint32, then `(value / 0xFFFFFFFF) * 100`.
 *
 * Arg order matches Definitions: `computePercentile(userId, featureKey)`
 * while the hashed string is featureKey-first.
 */
export function computePercentile(userId: string, featureKey: string): number {
  const input = `${featureKey}\n${userId}`
  const buf = createHash('sha256').update(input, 'utf8').digest()
  const value = buf.readUInt32LE(0)
  return (value / 0xffffffff) * 100
}

/**
 * @deprecated Use {@link computePercentile} with both identity and featureKey.
 * Kept as an alias that still requires a feature seed — prefer
 * `computePercentile(identity, featureKey)`.
 */
export function identityBucket(identity: string, featureKey = ''): number {
  return computePercentile(identity, featureKey)
}

/**
 * @deprecated Use {@link computePercentile}(identity, featureKey).
 */
export function rolloutBucket(featureKey: string, identity: string): number {
  return computePercentile(identity, featureKey)
}
