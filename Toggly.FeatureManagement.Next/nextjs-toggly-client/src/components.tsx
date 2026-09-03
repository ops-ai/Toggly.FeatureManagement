'use client'

import React, { type ReactNode } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import { useFeatureFlag, useFeatureGate } from './hooks'
import type { FeatureProps } from './types'

function FeatureFallback({ children }: { children?: ReactNode }): ReactNode {
  return children ?? null
}

function isFallbackElement(
  child: ReactNode
): child is React.ReactElement<{ children?: ReactNode }> {
  return React.isValidElement(child) && child.type === FeatureFallback
}

function splitFallback(children: ReactNode): {
  content: ReactNode
  nestedFallback: ReactNode | undefined
} {
  const content: ReactNode[] = []
  let nestedFallback: ReactNode | undefined

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

function FeatureRoot({
  featureKey,
  requirement = 'all',
  negate = false,
  children,
  fallback,
  loading = null,
}: FeatureProps): ReactNode {
  const { content, nestedFallback } = splitFallback(children)
  const resolvedFallback = fallback ?? nestedFallback ?? null
  const featureKeys = Array.isArray(featureKey) ? featureKey : [featureKey]

  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate
  )

  if (isLoading) {
    return loading
  }

  return isAllowed ? content : resolvedFallback
}

/**
 * Client Component for feature flag rendering.
 * Disabled content: `fallback` prop or `<Feature.Fallback>`.
 */
export const Feature = Object.assign(FeatureRoot, {
  Fallback: FeatureFallback,
})

function FeatureOffRoot({
  featureKey,
  requirement = 'all',
  children,
  fallback,
  loading = null,
}: Omit<FeatureProps, 'negate'>): ReactNode {
  return (
    <Feature
      featureKey={featureKey}
      requirement={requirement}
      negate={true}
      fallback={fallback}
      loading={loading}
    >
      {children}
    </Feature>
  )
}

/**
 * Client Component to render when feature is OFF.
 * Alternate content: `fallback` prop or `<FeatureOff.Fallback>`.
 */
export const FeatureOff = Object.assign(FeatureOffRoot, {
  Fallback: FeatureFallback,
})

/**
 * Client Component for A/B testing / variant rendering
 */
export function FeatureVariant({
  featureKey,
  enabled,
  disabled,
  loading = null,
}: {
  featureKey: string
  enabled: ReactNode
  disabled: ReactNode
  loading?: ReactNode
}): ReactNode {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey)

  if (isLoading) {
    return loading
  }

  return isEnabled ? enabled : disabled
}

function FeatureGateRoot({
  featureKeys,
  requirement = 'all',
  negate = false,
  children,
  fallback,
  loading = null,
}: {
  featureKeys: string[]
  requirement?: FeatureRequirement
  negate?: boolean
  children: ReactNode
  fallback?: ReactNode
  loading?: ReactNode
}): ReactNode {
  const { content, nestedFallback } = splitFallback(children)
  const resolvedFallback = fallback ?? nestedFallback ?? null
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate
  )

  if (isLoading) {
    return loading
  }

  return isAllowed ? content : resolvedFallback
}

/**
 * Client Component for feature gate with multiple features.
 * Failed-gate content: `fallback` prop or `<FeatureGate.Fallback>`.
 */
export const FeatureGate = Object.assign(FeatureGateRoot, {
  Fallback: FeatureFallback,
})

/**
 * Client Component that renders different content based on feature state
 */
export function FeatureSwitch({
  featureKey,
  cases,
}: {
  featureKey: string
  cases: {
    on: ReactNode
    off: ReactNode
    loading?: ReactNode
  }
}): ReactNode {
  const { isEnabled, isLoading } = useFeatureFlag(featureKey)

  if (isLoading) {
    return cases.loading ?? null
  }

  return isEnabled ? cases.on : cases.off
}
