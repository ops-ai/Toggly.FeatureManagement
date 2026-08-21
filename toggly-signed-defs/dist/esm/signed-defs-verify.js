/**
 * Browser / React Native signed-definitions verification (ES256).
 *
 * Matches Go toggly/crypto/verify.go and Node @ops-ai/toggly-node-core:
 * payload = exact raw defs JSON + "|" + timestamp
 * digest  = SHA-256(SHA-256(utf8(payload)))
 * signature = standard or URL-safe base64 of IEEE P1363 (r||s) or DER
 *
 * On Node (and Jest) we verify with crypto.verify(null, doubleHash).
 * In browsers, WebCrypto's ECDSA verify hashes again, so we pass the first
 * SHA-256 digest into subtle.verify (effective double-hash). DER signatures
 * are converted to P1363 before subtle.verify.
 */
import { assertEnvelopeFreshness, } from './freshness';
export { assertEnvelopeFreshness } from './freshness';
/**
 * Extract the exact raw JSON text of a **top-level** property only.
 * Nested keys (e.g. data.defs) are ignored so unsigned outer fields cannot
 * be swapped in after verifying nested signed bytes.
 */
export function extractRawJsonProperty(text, key) {
    let index = 0;
    let depth = 0;
    let inString = false;
    let escape = false;
    while (index < text.length) {
        const character = text[index];
        if (inString) {
            if (escape) {
                escape = false;
            }
            else if (character === '\\') {
                escape = true;
            }
            else if (character === '"') {
                inString = false;
            }
            index += 1;
            continue;
        }
        if (character === '"') {
            if (depth === 1) {
                const keyEnd = findStringEnd(text, index);
                if (keyEnd == null) {
                    return null;
                }
                const propertyName = text.slice(index + 1, keyEnd);
                let valueStart = keyEnd + 1;
                while (valueStart < text.length && /\s/.test(text[valueStart])) {
                    valueStart += 1;
                }
                if (propertyName === key && valueStart < text.length && text[valueStart] === ':') {
                    valueStart += 1;
                    while (valueStart < text.length && /\s/.test(text[valueStart])) {
                        valueStart += 1;
                    }
                    return extractJsonValue(text, valueStart);
                }
                index = keyEnd + 1;
                continue;
            }
            inString = true;
            index += 1;
            continue;
        }
        if (character === '{' || character === '[') {
            depth += 1;
        }
        else if (character === '}' || character === ']') {
            depth -= 1;
        }
        index += 1;
    }
    return null;
}
function findStringEnd(text, startQuote) {
    let escape = false;
    for (let i = startQuote + 1; i < text.length; i++) {
        const c = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (c === '\\') {
            escape = true;
            continue;
        }
        if (c === '"') {
            return i;
        }
    }
    return null;
}
function extractJsonValue(text, start) {
    if (start >= text.length) {
        return null;
    }
    const first = text[start];
    if (first === '{' || first === '[') {
        let depth = 0;
        let inString = false;
        let escape = false;
        for (let j = start; j < text.length; j++) {
            const c = text[j];
            if (inString) {
                if (escape) {
                    escape = false;
                }
                else if (c === '\\') {
                    escape = true;
                }
                else if (c === '"') {
                    inString = false;
                }
                continue;
            }
            if (c === '"') {
                inString = true;
            }
            else if (c === '{' || c === '[') {
                depth += 1;
            }
            else if (c === '}' || c === ']') {
                depth -= 1;
                if (depth === 0) {
                    return text.slice(start, j + 1);
                }
            }
        }
        return null;
    }
    if (first === '"') {
        const end = findStringEnd(text, start);
        return end == null ? null : text.slice(start, end + 1);
    }
    let j = start;
    while (j < text.length && /[^\s,}\]]/.test(text[j])) {
        j += 1;
    }
    return text.slice(start, j);
}
export function parseSignedEnvelope(bodyText) {
    const parsed = JSON.parse(bodyText);
    if (parsed == null ||
        typeof parsed !== 'object' ||
        typeof parsed.signature !== 'string' ||
        parsed.signature.length === 0 ||
        typeof parsed.kid !== 'string' ||
        parsed.kid.length === 0 ||
        typeof parsed.timestamp !== 'number') {
        throw new Error('Invalid signed definitions envelope');
    }
    const defsRaw = extractRawJsonProperty(bodyText, 'defs') ??
        extractRawJsonProperty(bodyText, 'data');
    if (!defsRaw) {
        throw new Error('Signed envelope missing defs');
    }
    return { envelope: parsed, defsRaw };
}
/** Parse the verified raw defs JSON — never use envelope.defs after verify. */
export function parseDefinitionsFromRaw(defsRaw) {
    return JSON.parse(defsRaw);
}
function padBase64Url(value) {
    const remainder = value.length % 4;
    if (remainder === 0)
        return value;
    return value + '='.repeat(4 - remainder);
}
export function base64ToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = padBase64Url(normalized);
    const maybeBuffer = globalThis.Buffer;
    if (maybeBuffer) {
        const buf = maybeBuffer.from(padded, 'base64');
        return Uint8Array.from(buf);
    }
    if (typeof atob !== 'function') {
        throw new Error('base64 decoding is not available in this environment');
    }
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
/**
 * Convert ASN.1/DER ECDSA signature (SEQUENCE of two INTEGERs) to IEEE P1363
 * (r||s, 64 bytes for P-256). WebCrypto subtle.verify only accepts P1363.
 */
export function derSignatureToP1363(der) {
    if (der.length < 8 || der[0] !== 0x30) {
        throw new Error('invalid DER signature');
    }
    let offset = 1;
    const readLength = () => {
        const first = der[offset++];
        if (first < 0x80) {
            return first;
        }
        const count = first & 0x7f;
        if (count === 0 || count > 2 || offset + count > der.length) {
            throw new Error('invalid DER length');
        }
        let value = 0;
        for (let i = 0; i < count; i++) {
            value = (value << 8) | der[offset++];
        }
        return value;
    };
    readLength(); // sequence length
    const readInteger = () => {
        if (der[offset++] !== 0x02) {
            throw new Error('invalid DER integer');
        }
        const length = readLength();
        if (offset + length > der.length) {
            throw new Error('invalid DER integer length');
        }
        let start = offset;
        let end = offset + length;
        // Strip leading zero padding used for sign bit.
        while (end - start > 32 && der[start] === 0x00) {
            start += 1;
        }
        const out = new Uint8Array(32);
        const src = der.subarray(start, end);
        if (src.length > 32) {
            throw new Error('DER integer too large for P-256');
        }
        out.set(src, 32 - src.length);
        offset = end;
        return out;
    };
    const r = readInteger();
    const s = readInteger();
    const p1363 = new Uint8Array(64);
    p1363.set(r, 0);
    p1363.set(s, 32);
    return p1363;
}
function toP1363Signature(signature) {
    if (signature.length === 64) {
        return signature;
    }
    return derSignatureToP1363(signature);
}
function isNodeRuntime() {
    return (typeof process !== 'undefined' &&
        typeof process.versions?.node === 'string');
}
async function sha1HexUpper(bytes) {
    if (isNodeRuntime()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('crypto');
        return nodeCrypto.createHash('sha1').update(bytes).digest('hex').toUpperCase();
    }
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const exact = bytes.slice();
        const digest = await crypto.subtle.digest('SHA-1', exact);
        return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
            .join('');
    }
    throw new Error('WebCrypto is required to validate JWKs');
}
async function sha256Bytes(data) {
    if (isNodeRuntime()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('crypto');
        return Uint8Array.from(nodeCrypto.createHash('sha256').update(data).digest());
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('WebCrypto is required to hash signed definitions');
    }
    const digest = await crypto.subtle.digest('SHA-256', data.slice());
    return new Uint8Array(digest);
}
export async function computeKid(x, y) {
    const xBytes = base64ToBytes(x);
    const yBytes = base64ToBytes(y);
    const combined = new Uint8Array(xBytes.length + yBytes.length);
    combined.set(xBytes, 0);
    combined.set(yBytes, xBytes.length);
    const digest = await sha1HexUpper(combined);
    return `${digest}ES256`;
}
/**
 * Verify a signed definitions envelope using exact raw defs bytes.
 *
 * After a successful verify, callers MUST apply `parseDefinitionsFromRaw(defsRaw)`
 * — never `envelope.defs` from JSON.parse of the outer body.
 */
export async function verifySignedDefinitions(defsRaw, envelope, jwks, allowedKids, freshness) {
    assertEnvelopeFreshness(envelope.timestamp, freshness);
    if (allowedKids?.length && !allowedKids.includes(envelope.kid)) {
        throw new Error(`kid not allowed: ${envelope.kid}`);
    }
    const matching = jwks.keys.find((k) => k.kid === envelope.kid);
    if (!matching) {
        throw new Error(`no matching jwk for kid "${envelope.kid}"`);
    }
    if (matching.alg !== 'ES256') {
        throw new Error(`unsupported alg: ${matching.alg ?? ''}`);
    }
    if (matching.crv !== 'P-256') {
        throw new Error(`unsupported crv: ${matching.crv ?? ''}`);
    }
    if (!matching.x || !matching.y) {
        throw new Error('missing x or y coordinate');
    }
    const expectedKid = await computeKid(matching.x, matching.y);
    if (matching.kid !== expectedKid) {
        throw new Error(`invalid kid: expected ${expectedKid}, got ${matching.kid}`);
    }
    const payloadBytes = new TextEncoder().encode(`${defsRaw}|${envelope.timestamp}`);
    const firstDigest = await sha256Bytes(payloadBytes);
    const doubleDigest = await sha256Bytes(firstDigest);
    const signature = base64ToBytes(envelope.signature);
    if (isNodeRuntime()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const nodeCrypto = require('crypto');
        const key = nodeCrypto.createPublicKey({
            key: {
                kty: matching.kty ?? 'EC',
                crv: matching.crv ?? 'P-256',
                x: matching.x,
                y: matching.y,
            },
            format: 'jwk',
        });
        const encoding = signature.length === 64 ? 'ieee-p1363' : 'der';
        const ok = nodeCrypto.verify(null, doubleDigest, { key, dsaEncoding: encoding }, signature);
        if (!ok) {
            throw new Error('invalid signature');
        }
        return;
    }
    if (typeof crypto === 'undefined' || !crypto.subtle) {
        throw new Error('WebCrypto is required to verify signed definitions');
    }
    const cryptoKey = await crypto.subtle.importKey('jwk', {
        kty: matching.kty ?? 'EC',
        crv: matching.crv ?? 'P-256',
        x: matching.x,
        y: matching.y,
        ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const p1363 = toP1363Signature(signature);
    const isValid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, p1363, firstDigest);
    if (!isValid) {
        throw new Error('invalid signature');
    }
}
