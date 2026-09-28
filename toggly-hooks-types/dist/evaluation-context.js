"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_EVALUATION_CLAIMS = void 0;
exports.normalizeEvaluationClaims = normalizeEvaluationClaims;
exports.buildEvaluatedSignedUrl = buildEvaluatedSignedUrl;
exports.appendEvaluationContext = appendEvaluationContext;
exports.evaluationContextCacheKey = evaluationContextCacheKey;
/** Maximum claim entries sent or honored on evaluated-signed requests (worker enforces the same cap). */
exports.MAX_EVALUATION_CLAIMS = 20;
/**
 * Produces a stable English alphabetical order without relying on the host
 * default locale.
 * Unicode strings which collate equally use their ordinal representation as a
 * deterministic tie-breaker so their input order never changes a cache key.
 */
function compareEvaluationContextKeys(a, b) {
    const collated = a.localeCompare(b, 'en');
    if (collated !== 0 || a === b) {
        return collated;
    }
    return a < b ? -1 : 1;
}
/**
 * Returns up to {@link MAX_EVALUATION_CLAIMS} claims, sorted by type for stable URLs and cache keys.
 * Extra entries are dropped deterministically (alphabetically last types first).
 */
function normalizeEvaluationClaims(claims) {
    if (!claims) {
        return undefined;
    }
    const entries = Object.entries(claims)
        .filter(([type, value]) => type && value !== undefined && value !== null && String(value).length > 0)
        .sort(([a], [b]) => compareEvaluationContextKeys(a, b));
    if (entries.length === 0) {
        return undefined;
    }
    return Object.fromEntries(entries.slice(0, exports.MAX_EVALUATION_CLAIMS));
}
/** Build an evaluated-signed (or variants-signed) definitions URL with evaluation context. */
function buildEvaluatedSignedUrl(baseURI, appKey, environment, context, variants) {
    const base = baseURI.replace(/\/$/, '');
    const path = variants ? 'evaluated-variants-signed' : 'evaluated-signed';
    const url = new URL(`${base}/${path}/${appKey}/${environment}`);
    appendEvaluationContext(url, context, variants ? 'variants' : 'evaluated');
    return url.toString();
}
/**
 * Append identity, groups, and claims to an evaluated-signed fetch URL.
 *
 * Contract (Definitions worker):
 * - evaluated mode: `?u=` for identity
 * - variants mode: `?userId=` for identity
 * - groups: repeatable `g` query params
 * - claims: `claim.{type}={value}` per claim entry (max {@link MAX_EVALUATION_CLAIMS})
 */
function appendEvaluationContext(url, context, mode = 'evaluated') {
    if (!context) {
        return;
    }
    if (context.identity) {
        if (mode === 'variants') {
            url.searchParams.set('userId', context.identity);
        }
        else {
            url.searchParams.set('u', context.identity);
        }
    }
    if (context.groups) {
        for (const group of context.groups) {
            const trimmed = group.trim();
            if (trimmed) {
                url.searchParams.append('g', trimmed);
            }
        }
    }
    const claims = normalizeEvaluationClaims(context.claims);
    if (claims) {
        for (const [claimType, claimValue] of Object.entries(claims)) {
            url.searchParams.set(`claim.${claimType}`, String(claimValue));
        }
    }
}
/**
 * Stable cache key segment for evaluation context (identity + groups + claims).
 */
function evaluationContextCacheKey(context) {
    if (!context) {
        return '';
    }
    const parts = [];
    if (context.identity) {
        parts.push(`u:${context.identity}`);
    }
    if (context.groups?.length) {
        parts.push(`g:${[...context.groups].sort(compareEvaluationContextKeys).join(',')}`);
    }
    if (context.claims && Object.keys(context.claims).length > 0) {
        const normalized = normalizeEvaluationClaims(context.claims);
        if (normalized) {
            const claimPairs = Object.entries(normalized)
                .sort(([a], [b]) => compareEvaluationContextKeys(a, b))
                .map(([k, v]) => `${k}=${v}`);
            parts.push(`c:${claimPairs.join('&')}`);
        }
    }
    return parts.join('|');
}
