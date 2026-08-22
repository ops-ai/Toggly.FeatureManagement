/**
 * Shared helpers for parsing evaluated-signed API responses.
 * When verifySignatures is enabled, verifies the ES256 envelope before applying defs.
 */
import { type JwkSet } from './signed-defs-verify';
export interface VerifySignatureOptions {
    verifySignatures?: boolean;
    /** Preferred base URL field (Astro / Gatsby / Nuxt / Remix / Docusaurus). */
    baseURI?: string;
    /** Alias used by Next.js packages. */
    baseUri?: string;
    /** Alias used by Remix and some server clients. */
    baseUrl?: string;
    allowedKeyIds?: string[];
    maxSignatureAgeSeconds?: number;
    headers?: HeadersInit;
    /** Optional fetch override (tests / Docusaurus). Defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Optional JWKS provider (in-memory cache). Defaults to a one-shot JWKS fetch. */
    getJwks?: () => Promise<JwkSet>;
}
/**
 * Read response body as text (prefer text() for raw-defs verification).
 */
export declare function readResponseBody(response: Response): Promise<string>;
/**
 * Parse an evaluated-signed body.
 * With verifySignatures: verify envelope and return parsed defs (never envelope.defs).
 * Without: JSON.parse as today (may be `{ defs }` or a bare map).
 */
export declare function parseEvaluatedResponseBody(bodyText: string, options: VerifySignatureOptions): Promise<unknown>;
/** In-memory JWKS cache used by client SDKs across refreshes. */
export declare class InMemoryJwksCache {
    private jwks;
    clear(): void;
    get(options: VerifySignatureOptions, forceRefresh?: boolean): Promise<JwkSet>;
}
/**
 * Read an evaluated-signed HTTP body and return unwrapped defs.
 * Unsigned payloads may be `{ defs }` or a bare map; signed payloads are verified first.
 */
export declare function readAndParseEvaluatedResponse(response: Response, options: VerifySignatureOptions): Promise<unknown>;
/** Build parse options that reuse an in-memory JWKS cache. */
export declare function signedDefsClientOptions(config: Omit<Pick<VerifySignatureOptions, 'verifySignatures' | 'baseURI' | 'baseUri' | 'allowedKeyIds' | 'maxSignatureAgeSeconds' | 'headers' | 'fetchImpl'>, 'maxSignatureAgeSeconds'> & {
    maxSignatureAgeSeconds?: number | null;
}, jwks: InMemoryJwksCache): VerifySignatureOptions;
/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export declare function unwrapDefsPayload(payload: unknown): unknown;
export type { EvaluatedDefinitions, EvaluatedDefinitionValue, EntityGate, EntityGateRule } from './evaluated-definitions';
