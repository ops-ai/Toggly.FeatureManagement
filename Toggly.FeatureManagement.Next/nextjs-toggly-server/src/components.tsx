import type { ReactNode } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import type { EntityContextInput } from './feature-check'
import { waitForServerToggly } from './server-client'

/**
 * Props for server Feature component
 */
export interface FeatureProps {
  /** Feature key(s) to check */
  featureKey: string | string[]
  /** Requirement for multiple features: 'all' or 'any' */
  requirement?: FeatureRequirement
  /** When true, render children when the feature is off */
  negate?: boolean
  /** User identity for targeting (per-call; does not mutate the shared client) */
  identity?: string
  /** Entity / page object for Context Property filters */
  context?: EntityContextInput
  /** Catalog kind when `context` is a domain object */
  contextKind?: string
  /** Content to render when the gate passes */
  children: ReactNode
}

/**
 * Server Component for feature flag rendering.
 * Use `negate` to render when the feature is off (same as .NET `<feature negate>`).
 */
export async function Feature({
  featureKey,
  requirement = 'all',
  negate = false,
  identity,
  context,
  contextKind,
  children,
}: FeatureProps): Promise<ReactNode> {
  const client = await waitForServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized in Feature component')
    return negate ? children : null
  }

  const featureKeys = Array.isArray(featureKey) ? featureKey : [featureKey]
  const isEnabled = await client.evaluateFeatureGate(
    featureKeys,
    requirement,
    negate,
    context,
    contextKind,
    identity
  )

  return isEnabled ? children : null
}

/**
 * Server Component for A/B testing / variant rendering
 */
export async function FeatureVariant({
  featureKey,
  identity,
  context,
  contextKind,
  enabled,
  disabled,
}: {
  featureKey: string
  identity?: string
  context?: FeatureProps['context']
  contextKind?: string
  enabled: ReactNode
  disabled: ReactNode
}): Promise<ReactNode> {
  const client = await waitForServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized in FeatureVariant')
    return disabled
  }

  const isEnabled = await client.evaluateFeatureGate(
    [featureKey],
    'all',
    false,
    context,
    contextKind,
    identity
  )

  return isEnabled ? enabled : disabled
}
