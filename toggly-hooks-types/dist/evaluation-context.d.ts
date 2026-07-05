export interface TogglyEvaluationContext {
    identity?: string;
    groups?: string[];
    claims?: Record<string, string>;
}
export type EvaluationUrlMode = 'evaluated' | 'variants';
/** Maximum claim entries sent or honored on evaluated-signed requests (worker enforces the same cap). */
export declare const MAX_EVALUATION_CLAIMS = 20;
/**
 * Returns up to {@link MAX_EVALUATION_CLAIMS} claims, sorted by type for stable URLs and cache keys.
 * Extra entries are dropped deterministically (alphabetically last types first).
 */
export declare function normalizeEvaluationClaims(claims: Record<string, string> | undefined): Record<string, string> | undefined;
/**
 * Append identity, groups, and claims to an evaluated-signed fetch URL.
 *
 * Contract (Definitions worker):
 * - evaluated mode: `?u=` for identity
 * - variants mode: `?userId=` for identity
 * - groups: repeatable `g` query params
 * - claims: `claim.{type}={value}` per claim entry (max {@link MAX_EVALUATION_CLAIMS})
 */
export declare function appendEvaluationContext(url: URL, context: TogglyEvaluationContext | undefined, mode?: EvaluationUrlMode): void;
/**
 * Stable cache key segment for evaluation context (identity + groups + claims).
 */
export declare function evaluationContextCacheKey(context: TogglyEvaluationContext | undefined): string;
