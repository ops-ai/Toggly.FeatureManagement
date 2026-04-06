import { useContext, useEffect, useState } from 'react'
import { context } from '../contexts'
import type { VariantResult } from '../services'

/**
 * Subscribes to the current {@link VariantResult} for a feature when variants are enabled on the service.
 * Re-renders after feature definitions refresh (HTTP load or WebSocket update).
 */
export function useVariant(featureKey: string): VariantResult | null {
  const { toggly } = useContext(context)

  const [variant, setVariant] = useState<VariantResult | null>(() =>
    toggly?.getVariant(featureKey) ?? null,
  )

  useEffect(() => {
    if (!toggly) {
      setVariant(null)
      return undefined
    }

    const sync = () => {
      setVariant(toggly.getVariant(featureKey))
    }

    sync()
    return toggly.subscribeFeaturesRefresh(sync)
  }, [toggly, featureKey])

  return variant
}
