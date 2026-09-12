import { webcrypto } from 'node:crypto';
/** Node entry points retain support for Node 18 without global WebCrypto. */
export function getSubtleCrypto() {
    return webcrypto.subtle;
}
