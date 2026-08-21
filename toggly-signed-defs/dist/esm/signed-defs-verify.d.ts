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
import { type VerifyFreshnessOptions } from './freshness';
export type { VerifyFreshnessOptions };
export { assertEnvelopeFreshness } from './freshness';
export interface SignedEnvelope {
    defs?: unknown;
    data?: unknown;
    signature: string;
    timestamp: number;
    kid: string;
}
export interface Jwk {
    kty?: string;
    use?: string;
    kid: string;
    crv?: string;
    x?: string;
    y?: string;
    alg?: string;
}
export interface JwkSet {
    keys: Jwk[];
}
/**
 * Extract the exact raw JSON text of a **top-level** property only.
 * Nested keys (e.g. data.defs) are ignored so unsigned outer fields cannot
 * be swapped in after verifying nested signed bytes.
 */
export declare function extractRawJsonProperty(text: string, key: string): string | null;
export declare function parseSignedEnvelope(bodyText: string): {
    envelope: SignedEnvelope;
    defsRaw: string;
};
/** Parse the verified raw defs JSON — never use envelope.defs after verify. */
export declare function parseDefinitionsFromRaw(defsRaw: string): unknown;
export declare function base64ToBytes(value: string): Uint8Array;
/**
 * Convert ASN.1/DER ECDSA signature (SEQUENCE of two INTEGERs) to IEEE P1363
 * (r||s, 64 bytes for P-256). WebCrypto subtle.verify only accepts P1363.
 */
export declare function derSignatureToP1363(der: Uint8Array): Uint8Array;
export declare function computeKid(x: string, y: string): Promise<string>;
/**
 * Verify a signed definitions envelope using exact raw defs bytes.
 *
 * After a successful verify, callers MUST apply `parseDefinitionsFromRaw(defsRaw)`
 * — never `envelope.defs` from JSON.parse of the outer body.
 */
export declare function verifySignedDefinitions(defsRaw: string, envelope: Pick<SignedEnvelope, 'signature' | 'timestamp' | 'kid'>, jwks: JwkSet, allowedKids?: ReadonlyArray<string> | null, freshness?: VerifyFreshnessOptions | null): Promise<void>;
