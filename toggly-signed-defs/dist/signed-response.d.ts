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
/**
 * Parse an evaluated-signed response using an in-memory JWKS cache.
 * Client SDKs pass their existing config object plus optional fetch headers.
 */
export declare function readAndParseEvaluatedResponseCached(response: Response, jwks: InMemoryJwksCache, config: {
    verifySignatures?: boolean;
    baseURI?: string;
    baseUri?: string;
    baseUrl?: string;
    allowedKeyIds?: string[];
    maxSignatureAgeSeconds?: number | null;
    fetchImpl?: typeof fetch;
}, headers?: HeadersInit): Promise<unknown>;
export type EvaluatedSignedFetchConfig = {
    verifySignatures?: boolean;
    baseURI?: string;
    baseUri?: string;
    baseUrl?: string;
    allowedKeyIds?: string[];
    maxSignatureAgeSeconds?: number | null;
    fetchImpl?: typeof fetch;
};
export type EvaluatedSignedFetchResult = {
    notModified: true;
    revision: string | null;
} | {
    notModified: false;
    defs: unknown;
    revision: string | null;
};
/**
 * Fetch evaluated-signed defs, honor If-None-Match / 304, and parse through the JWKS cache.
 */
export declare function fetchEvaluatedSignedDefinitions(url: string, jwks: InMemoryJwksCache, config: EvaluatedSignedFetchConfig, request?: {
    revision?: string | null;
    headers?: HeadersInit;
}): Promise<EvaluatedSignedFetchResult>;
/** Build parse options that reuse an in-memory JWKS cache. */
export declare function signedDefsClientOptions(config: Omit<Pick<VerifySignatureOptions, 'verifySignatures' | 'baseURI' | 'baseUri' | 'baseUrl' | 'allowedKeyIds' | 'maxSignatureAgeSeconds' | 'headers' | 'fetchImpl'>, 'maxSignatureAgeSeconds'> & {
    maxSignatureAgeSeconds?: number | null;
}, jwks: InMemoryJwksCache): VerifySignatureOptions;
/**
 * Reject HTTP 2xx bodies whose primary payload is an error envelope without
 * defs or features. Mirrors nextjs-toggly-core parseRemoteEvaluatedPayload.
 */
export declare function rejectEvaluatedErrorEnvelope(payload: unknown): void;
/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export declare function unwrapDefsPayload(payload: unknown): unknown;
/** Coerce evaluated-variants payload to a defs map; arrays/primitives become `{}`. */
export declare function asVariantDefsRecord<T>(parsedDefs: unknown): Record<string, T>;
export type EvaluatedFetchErrorRecovery<TFlags, TVariants> = {
    variants: TVariants | null;
    features: TFlags;
};
/**
 * Shared fallback when evaluated-signed fetch fails: prefer cached variants,
 * else flags/defaults when features were never loaded. Returns null to keep
 * in-memory state unchanged.
 */
export declare function resolveEvaluatedFetchErrorState<TFlags, TVariants>(input: {
    enableVariants: boolean;
    featuresAlreadyLoaded: boolean;
    readVariants: () => TVariants | null | undefined;
    readFlags: () => TFlags | null | undefined;
    defaults: TFlags;
    variantsToFlags: (variants: TVariants) => TFlags;
}): EvaluatedFetchErrorRecovery<TFlags, TVariants> | null;
export type { EvaluatedDefinitions, EvaluatedDefinitionValue, EntityGate, EntityGateRule } from './evaluated-definitions';
