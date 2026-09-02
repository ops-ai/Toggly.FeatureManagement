import type { FilterEvaluator } from './types';
import { identityBucket, rolloutBucket } from './hash';
export declare function asFloat(params: Record<string, unknown> | undefined, key: string): number | undefined;
export declare function asBool(params: Record<string, unknown> | undefined, key: string): boolean | undefined;
export declare function asString(params: Record<string, unknown> | undefined, key: string): string | undefined;
export declare const alwaysOn: FilterEvaluator;
export declare const alwaysOff: FilterEvaluator;
export declare const percentage: FilterEvaluator;
/** Test hook to pin TimeWindow "now". */
export declare function setTimeWindowNow(fn: (() => Date) | undefined): void;
export declare const timeWindow: FilterEvaluator;
export declare const targeting: FilterEvaluator;
export declare function createDefaultRegistry(): Map<string, FilterEvaluator>;
/** Exported for tests that need bucket values. */
export { identityBucket, rolloutBucket };
