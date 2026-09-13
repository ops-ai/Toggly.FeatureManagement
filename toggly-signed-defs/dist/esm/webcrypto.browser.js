/** Browser builds select this provider instead of the Node-only module. */
export function getSubtleCrypto() {
    if (!globalThis.crypto?.subtle) {
        throw new Error('WebCrypto is required to verify signed definitions');
    }
    return globalThis.crypto.subtle;
}
