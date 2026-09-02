import React from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import type { EntityContextInput } from './feature-check'
import { getServerToggly } from './server-client'

/**
 * Props for server Feature component
 */
export interface FeatureProps {
  /** Feature key(s) to check */
  featureKey: string | string[]
  /** Requirement for multiple features: 'all' or 'any' */
  requirement?: FeatureRequirement
  /** Negate the result */
  negate?: boolean
  /** User identity for targeting (per-call; does not mutate the shared client) */
  identity?: string
  /** Entity / page object for Context Property filters */
  context?: EntityContextInput
  /** Catalog kind when `context` is a domain object */
  contextKind?: string
  /** Content to render when feature is enabled */
  children: React.ReactNode
  /** Content to render when feature is disabled */
  fallback?: React.ReactNode
}

/**
 * Server Component for feature flag rendering
 *
 * @example
 * ```tsx
 * // In a Server Component
 * import { Feature } from '@ops-ai/nextjs-toggly-server'
 *
 * export default async function Page() {
 *   return (
 *     <Feature featureKey="new-dashboard">
 *       <NewDashboard />
 *     </Feature>
 *   )
 * }
 * ```
 */
export async function Feature({
  featureKey,
  requirement = 'all',
  negate = false,
  identity,
  context,
  contextKind,
  children,
  fallback = null,
}: FeatureProps): Promise<React.ReactNode> {
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized in Feature component')
    return negate ? children : fallback
  }

  // Per-call identity / entity override (local eval); do not mutate shared client
  const featureKeys = Array.isArray(featureKey) ? featureKey : [featureKey]
  const isEnabled = await client.evaluateFeatureGate(
    featureKeys,
    requirement,
    negate,
    context,
    contextKind,
    identity
  )

  return isEnabled ? children : fallback
}

/**
 * Server Component to render when feature is OFF
 *
 * @example
 * ```tsx
 * import { FeatureOff } from '@ops-ai/nextjs-toggly-server'
 *
 * export default async function Page() {
 *   return (
 *     <FeatureOff featureKey="maintenance-mode">
 *       <MainContent />
 *     </FeatureOff>
 *   )
 * }
 * ```
 */
export async function FeatureOff({
  featureKey,
  requirement = 'all',
  identity,
  context,
  contextKind,
  children,
  fallback = null,
}: Omit<FeatureProps, 'negate'>): Promise<React.ReactNode> {
  return Feature({
    featureKey,
    requirement,
    negate: true,
    identity,
    context,
    contextKind,
    children,
    fallback,
  })
}

/**
 * Server Component for A/B testing / variant rendering
 *
 * @example
 * ```tsx
 * import { FeatureVariant } from '@ops-ai/nextjs-toggly-server'
 *
 * export default async function Page() {
 *   return (
 *     <FeatureVariant
 *       featureKey="checkout-flow"
 *       enabled={<NewCheckout />}
 *       disabled={<OldCheckout />}
 *     />
 *   )
 * }
 * ```
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
  enabled: React.ReactNode
  disabled: React.ReactNode
}): Promise<React.ReactNode> {
  return Feature({
    featureKey,
    identity,
    context,
    contextKind,
    children: enabled,
    fallback: disabled,
  })
}
