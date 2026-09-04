import type { ReactNode } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import {
  toEvalOverrides,
  type EntityContextInput,
  type FeatureCheckOptions,
} from './feature-check'
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
  /** Targeting groups for this evaluation */
  groups?: string[]
  /** UserClaims for this evaluation */
  claims?: Record<string, string>
  /** Explicit request context (UA / language / country) */
  request?: FeatureCheckOptions['request']
  /** HTTP headers mapped via fromHttpRequest (explicit request wins) */
  headers?: FeatureCheckOptions['headers']
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
  groups,
  claims,
  request,
  headers,
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
    toEvalOverrides({ identity, groups, claims, request, headers }),
  )

  return isEnabled ? children : null
}

/**
 * Server Component for A/B testing / variant rendering
 */
export async function FeatureVariant({
  featureKey,
  identity,
  groups,
  claims,
  request,
  headers,
  context,
  contextKind,
  enabled,
  disabled,
}: {
  featureKey: string
  identity?: string
  groups?: string[]
  claims?: Record<string, string>
  request?: FeatureCheckOptions['request']
  headers?: FeatureCheckOptions['headers']
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
    toEvalOverrides({ identity, groups, claims, request, headers }),
  )

  return isEnabled ? enabled : disabled
}
