/**
 * Re-export shared signed-definitions verification (single source of truth).
 */
export type { VerifyFreshnessOptions, SignedEnvelope, Jwk, JwkSet, } from '@ops-ai/toggly-signed-defs';
export { assertEnvelopeFreshness, extractRawJsonProperty, parseSignedEnvelope, parseDefinitionsFromRaw, base64ToBytes, derSignatureToP1363, computeKid, verifySignedDefinitions, } from '@ops-ai/toggly-signed-defs';
