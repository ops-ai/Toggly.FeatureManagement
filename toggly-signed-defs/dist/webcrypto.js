"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubtleCrypto = getSubtleCrypto;
const node_crypto_1 = require("node:crypto");
/** Node entry points retain support for Node 18 without global WebCrypto. */
function getSubtleCrypto() {
    return node_crypto_1.webcrypto.subtle;
}
