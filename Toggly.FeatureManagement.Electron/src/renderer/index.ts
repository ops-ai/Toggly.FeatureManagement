import type {
  EntityContextInput,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  SetContextInput,
  TogglyBridge,
} from '../types.js'

function tryBridge(): TogglyBridge | null {
  if (typeof window === 'undefined' || !window.toggly) {
    return null
  }
  return window.toggly
}

export function isFeatureOn(
  key: string,
  entityContext?: EntityContextInput,
  kind?: string,
): boolean {
  const bridge = tryBridge()
  if (!bridge) {
    return false
  }
  return bridge.isFeatureOn(key, entityContext, kind)
}

export function isFeatureOff(
  key: string,
  entityContext?: EntityContextInput,
  kind?: string,
): boolean {
  const bridge = tryBridge()
  if (!bridge) {
    return true
  }
  return bridge.isFeatureOff(key, entityContext, kind)
}

export function evaluateFeatureGate(
  keys: string[],
  requirement?: FeatureRequirement | string,
  negate?: boolean,
  entityContext?: EntityContextInput,
  kind?: string,
): boolean {
  const bridge = tryBridge()
  if (!bridge) {
    return negate ?? false
  }
  return bridge.evaluateFeatureGate(
    keys,
    requirement,
    negate,
    entityContext,
    kind,
  )
}

export function getFlags(): Promise<FeatureFlagsSnapshot> {
  const bridge = tryBridge()
  if (!bridge) {
    return Promise.reject(
      new Error(
        'window.toggly is not available. Call exposeToggly() from your preload script.',
      ),
    )
  }
  return bridge.getFlags()
}

export function setContext(
  context: SetContextInput,
): Promise<FeatureFlagsSnapshot> {
  const bridge = tryBridge()
  if (!bridge) {
    return Promise.reject(
      new Error(
        'window.toggly is not available. Call exposeToggly() from your preload script.',
      ),
    )
  }
  return bridge.setContext(context)
}

export function clearContext(): Promise<FeatureFlagsSnapshot> {
  const bridge = tryBridge()
  if (!bridge) {
    return Promise.reject(
      new Error(
        'window.toggly is not available. Call exposeToggly() from your preload script.',
      ),
    )
  }
  return bridge.clearContext()
}

export function onFlagsUpdated(
  callback: (flags: FeatureFlagsSnapshot) => void,
): () => void {
  const bridge = tryBridge()
  if (!bridge) {
    return () => undefined
  }
  return bridge.onFlagsUpdated(callback)
}

export type {
  TogglyBridge,
  FeatureFlagsSnapshot,
  FeatureRequirement,
  SetContextInput,
} from '../types.js'

export function recordUsage(key: string, variant = 'enabled'): void {
  tryBridge()?.recordUsage(key, variant)
}
export function recordView(key: string, variant = 'enabled'): void {
  tryBridge()?.recordView(key, variant)
}
export function incrementCounter(key: string, value = 1): void {
  tryBridge()?.incrementCounter(key, value)
}
export function setGauge(key: string, value: number): void {
  tryBridge()?.setGauge(key, value)
}
export function flushTelemetry(): Promise<void> {
  return tryBridge()?.flushTelemetry() ?? Promise.resolve()
}

/** @internal Subscription used by committed React consumers. */
export function onEvaluationsChanged(callback: () => void): () => void {
  return tryBridge()?.onEvaluationsChanged(callback) ?? (() => undefined)
}

export type { TogglyTelemetry } from '../types.js'
