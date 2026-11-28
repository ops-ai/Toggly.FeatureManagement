import type { VariantResult } from '../services';
/**
 * Subscribes to the current {@link VariantResult} for a feature when variants are enabled on the service.
 * Re-renders after feature definitions refresh (HTTP load or WebSocket update).
 */
export declare function useVariant(featureKey: string): VariantResult | null;
