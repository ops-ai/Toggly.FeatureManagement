import { useEffect, useState } from 'react';
import type { VariantResult } from '@ops-ai/react-native-toggly-core';
import { useTogglyContext } from '../contexts/TogglyContext';

/**
 * Subscribes to the current {@link VariantResult} for a feature (requires the owning
 * TogglyService to be configured with `enableVariants: true`).
 *
 * Re-renders after feature definitions refresh (HTTP load or WebSocket-driven update)
 * or after device-local gates change.
 *
 * @example
 * ```tsx
 * function Banner() {
 *   const variant = useVariant('checkoutBanner');
 *   if (!variant) return null;
 *   return <Text>{String(variant.configurationValue)}</Text>;
 * }
 * ```
 */
export function useVariant(featureKey: string): VariantResult | null {
  const { toggly, isReady } = useTogglyContext();

  const [variant, setVariant] = useState<VariantResult | null>(() => toggly.getVariant(featureKey));

  useEffect(() => {
    if (!isReady) return undefined;

    let retired = false;
    const sync = () => {
      if (!retired) setVariant(toggly.getVariant(featureKey));
    };
    const offRefresh = toggly.on('effectiveFlagsChanged', sync);
    const offLocalGates = toggly.on('localGatesChanged', sync);
    sync();

    return () => {
      retired = true;
      offRefresh();
      offLocalGates();
    };
  }, [toggly, isReady, featureKey]);

  return variant;
}
