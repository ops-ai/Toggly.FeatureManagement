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
    toggly?._getVariantSnapshot ? toggly._getVariantSnapshot(featureKey) : toggly?.getVariant(featureKey) ?? null,
  )

  useEffect(() => {
    if (!toggly) {
      setVariant(null)
      return undefined
    }

    let generation = 0
    const sync = () => {
      const current = ++generation
      const next = toggly.getVariant(featureKey)
      if (current === generation) setVariant(next)
    }
    const unsubRefresh = toggly.subscribeFeaturesRefresh(sync)
    const unsubLocalGates = toggly.subscribeLocalGatesChanged(sync)
    sync()
    return () => {
      generation++
      unsubRefresh()
      unsubLocalGates()
    }
  }, [toggly, featureKey])

  return variant
}
