"use strict";
/**
 * Shared helpers for parsing evaluated-signed API responses.
 * When verifySignatures is enabled, verifies the ES256 envelope before applying defs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryJwksCache = void 0;
exports.readResponseBody = readResponseBody;
exports.parseEvaluatedResponseBody = parseEvaluatedResponseBody;
exports.readAndParseEvaluatedResponse = readAndParseEvaluatedResponse;
exports.signedDefsClientOptions = signedDefsClientOptions;
exports.unwrapDefsPayload = unwrapDefsPayload;
const signed_defs_verify_1 = require("./signed-defs-verify");
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
async function readResponseBody(response) {
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
async function parseEvaluatedResponseBody(bodyText, options) {
    if (!options.verifySignatures) {
        return JSON.parse(bodyText);
    }
    const { envelope, defsRaw } = (0, signed_defs_verify_1.parseSignedEnvelope)(bodyText);
    const jwks = options.getJwks
        ? await options.getJwks()
        : await fetchJwks(resolveBaseUri(options), options.headers, options.fetchImpl ?? fetch);
    await (0, signed_defs_verify_1.verifySignedDefinitions)(defsRaw, {
        signature: envelope.signature,
        timestamp: envelope.timestamp,
        kid: envelope.kid,
    }, jwks, options.allowedKeyIds, options.maxSignatureAgeSeconds != null
        ? { maxSignatureAgeSeconds: options.maxSignatureAgeSeconds }
        : null);
    return (0, signed_defs_verify_1.parseDefinitionsFromRaw)(defsRaw);
}
/** In-memory JWKS cache used by client SDKs across refreshes. */
class InMemoryJwksCache {
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
exports.InMemoryJwksCache = InMemoryJwksCache;
/**
 * Read an evaluated-signed HTTP body and return unwrapped defs.
 * Unsigned payloads may be `{ defs }` or a bare map; signed payloads are verified first.
 */
async function readAndParseEvaluatedResponse(response, options) {
    const parsed = await parseEvaluatedResponseBody(await readResponseBody(response), options);
    return options.verifySignatures ? parsed : unwrapDefsPayload(parsed);
}
/** Build parse options that reuse an in-memory JWKS cache. */
function signedDefsClientOptions(config, jwks) {
    const baseURI = config.baseURI ?? config.baseUri;
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
function unwrapDefsPayload(payload) {
    if (typeof payload === 'object' && payload !== null && 'defs' in payload) {
        const defs = payload.defs;
        if (defs !== undefined) {
            return defs;
        }
    }
    return payload;
}
