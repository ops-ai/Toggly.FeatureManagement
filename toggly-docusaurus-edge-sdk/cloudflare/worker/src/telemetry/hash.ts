const utf8Encoder = new TextEncoder();

/**
 * FNV-1a 32-bit as signed int32 (matches Go `hash/fnv` New32a on `[]byte(s)`).
 * Hashes UTF-8 bytes — not UTF-16 code units from `String.charCodeAt`.
 */
export function hashIdentity(identity: string): number {
  let hash = 2166136261; // FNV offset basis
  const bytes = utf8Encoder.encode(identity);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 16777619); // FNV prime
  }
  const unsigned = hash >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}
