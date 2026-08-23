/**
 * Shared helpers for parsing evaluated-signed API responses.
 * When verifySignatures is enabled, verifies the ES256 envelope before applying defs.
 */
import { parseSignedEnvelope, verifySignedDefinitions, parseDefinitionsFromRaw, } from './signed-defs-verify.js';
function resolveBaseUri(options) {
    const base = options.baseURI ?? options.baseUri ?? options.baseUrl;
    if (!base) {
        throw new Error('baseURI (or baseUri) is required when verifySignatures is enabled');
    }
    return base;
}
async function fetchJwks(baseUri, headers, fetchImpl = fetch) {
    const base = baseUri.replace(/\/$/, '');
    const response = await fetchImpl(`${base}/.well-known/jwks`, {
        method: 'GET',
        headers,
    });
    if (!response.ok) {
        throw new Error(`JWKS fetch failed: HTTP ${response.status}`);
    }
    return (await response.json());
}
/**
 * Read response body as text (prefer text() for raw-defs verification).
 */
export async function readResponseBody(response) {
    if (typeof response.text === 'function') {
        return response.text();
    }
    return JSON.stringify(await response.json());
}
/**
 * Parse an evaluated-signed body.
 * With verifySignatures: verify envelope and return parsed defs (never envelope.defs).
 * Without: JSON.parse as today (may be `{ defs }` or a bare map).
 */
export async function parseEvaluatedResponseBody(bodyText, options) {
    if (!options.verifySignatures) {
        return JSON.parse(bodyText);
    }
    const { envelope, defsRaw } = parseSignedEnvelope(bodyText);
    const jwks = options.getJwks
        ? await options.getJwks()
        : await fetchJwks(resolveBaseUri(options), options.headers, options.fetchImpl ?? fetch);
    await verifySignedDefinitions(defsRaw, {
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        kid: envelope.kid,
    }, jwks, options.allowedKeyIds, options.maxSignatureAgeSeconds != null
        ? { maxSignatureAgeSeconds: options.maxSignatureAgeSeconds }
        : null);
    return parseDefinitionsFromRaw(defsRaw);
}
/** In-memory JWKS cache used by client SDKs across refreshes. */
export class InMemoryJwksCache {
    constructor() {
        this.jwks = null;
    }
    clear() {
        this.jwks = null;
    }
    async get(options, forceRefresh = false) {
        if (!forceRefresh && this.jwks) {
            return this.jwks;
        }
        this.jwks = await fetchJwks(resolveBaseUri(options), options.headers, options.fetchImpl ?? fetch);
        return this.jwks;
    }
}
/**
 * Read an evaluated-signed HTTP body and return unwrapped defs.
 * Unsigned payloads may be `{ defs }` or a bare map; signed payloads are verified first.
 */
export async function readAndParseEvaluatedResponse(response, options) {
    const parsed = await parseEvaluatedResponseBody(await readResponseBody(response), options);
    return options.verifySignatures ? parsed : unwrapDefsPayload(parsed);
}
/**
 * Parse an evaluated-signed response using an in-memory JWKS cache.
 * Client SDKs pass their existing config object plus optional fetch headers.
 */
export async function readAndParseEvaluatedResponseCached(response, jwks, config, headers) {
    return readAndParseEvaluatedResponse(response, signedDefsClientOptions({
        verifySignatures: config.verifySignatures,
        baseURI: config.baseURI,
        baseUri: config.baseUri ?? config.baseUrl,
        allowedKeyIds: config.allowedKeyIds,
        maxSignatureAgeSeconds: config.maxSignatureAgeSeconds,
        headers,
        fetchImpl: config.fetchImpl,
    }, jwks));
}
const DEFINITIONS_REVISION_HEADER = 'X-Definitions-Revision';
function revisionFromResponse(response) {
    const headers = response.headers;
    if (!headers || typeof headers.get !== 'function') {
        return null;
    }
    return headers.get(DEFINITIONS_REVISION_HEADER) ?? headers.get('ETag');
}
/**
 * Fetch evaluated-signed defs, honor If-None-Match / 304, and parse through the JWKS cache.
 */
export async function fetchEvaluatedSignedDefinitions(url, jwks, config, request = {}) {
    const fetchImpl = config.fetchImpl ?? fetch;
    const headers = new Headers(request.headers);
    if (request.revision) {
        headers.set('If-None-Match', request.revision);
    }
    const response = await fetchImpl(url, { headers });
    const revision = revisionFromResponse(response);
    if (response.status === 304) {
        return { notModified: true, revision };
    }
    if (!response.ok) {
        throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`);
    }
    const defs = await readAndParseEvaluatedResponseCached(response, jwks, config, request.headers);
    return { notModified: false, defs, revision };
}
/** Build parse options that reuse an in-memory JWKS cache. */
export function signedDefsClientOptions(config, jwks) {
    const baseURI = config.baseURI ?? config.baseUri ?? config.baseUrl;
    return {
        ...config,
        baseURI,
        maxSignatureAgeSeconds: config.maxSignatureAgeSeconds ?? undefined,
        getJwks: () => jwks.get({
            baseURI,
            headers: config.headers,
            fetchImpl: config.fetchImpl,
        }),
    };
}
/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export function unwrapDefsPayload(payload) {
    if (typeof payload === 'object' && payload !== null && 'defs' in payload) {
        const defs = payload.defs;
        if (defs !== undefined) {
            return defs;
        }
    }
    return payload;
}
