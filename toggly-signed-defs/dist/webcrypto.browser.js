"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubtleCrypto = getSubtleCrypto;
/** Browser builds select this provider instead of the Node-only module. */
function getSubtleCrypto() {
    if (!globalThis.crypto?.subtle) {
        throw new Error('WebCrypto is required to verify signed definitions');
    }
    return globalThis.crypto.subtle;
}
