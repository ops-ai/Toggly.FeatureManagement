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

function FeatureFallback({
  children,
}: {
  children?: React.ReactNode
}): React.ReactNode {
  return children ?? null
}

function isFallbackElement(
  child: React.ReactNode
): child is React.ReactElement<{ children?: React.ReactNode }> {
  return React.isValidElement(child) && child.type === FeatureFallback
}

function splitFallback(children: React.ReactNode): {
  content: React.ReactNode
  nestedFallback: React.ReactNode | undefined
} {
  const content: React.ReactNode[] = []
  let nestedFallback: React.ReactNode | undefined

  React.Children.forEach(children, (child) => {
    if (isFallbackElement(child)) {
      nestedFallback = child.props.children
      return
    }
    content.push(child)
  })

  if (content.length === 0) {
    return { content: null, nestedFallback }
  }
  if (content.length === 1) {
    return { content: content[0], nestedFallback }
  }
  return { content, nestedFallback }
}

async function FeatureRoot({
  featureKey,
  requirement = 'all',
  negate = false,
  identity,
  context,
  contextKind,
  children,
  fallback,
}: FeatureProps): Promise<React.ReactNode> {
  const { content, nestedFallback } = splitFallback(children)
  const resolvedFallback = fallback ?? nestedFallback ?? null
  const client = getServerToggly()

  if (!client) {
    console.warn('[Toggly] Server client not initialized in Feature component')
    return negate ? content : resolvedFallback
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

  return isEnabled ? content : resolvedFallback
}

/**
 * Server Component for feature flag rendering.
 * Disabled content: `fallback` prop or `<Feature.Fallback>`.
 */
export const Feature = Object.assign(FeatureRoot, {
  Fallback: FeatureFallback,
})

async function FeatureOffRoot({
  featureKey,
  requirement = 'all',
  identity,
  context,
  contextKind,
  children,
  fallback,
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
 * Server Component to render when feature is OFF.
 * Alternate content: `fallback` prop or `<FeatureOff.Fallback>`.
 */
export const FeatureOff = Object.assign(FeatureOffRoot, {
  Fallback: FeatureFallback,
})

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
