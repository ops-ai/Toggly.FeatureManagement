import { webcrypto } from 'node:crypto'

/** Node entry points retain support for Node 18 without global WebCrypto. */
export function getSubtleCrypto(): SubtleCrypto {
  return webcrypto.subtle as unknown as SubtleCrypto
}
