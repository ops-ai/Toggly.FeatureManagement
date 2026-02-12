'use client'

import type { ReactNode } from 'react'
import type { FeatureRequirement } from '@ops-ai/nextjs-toggly-core'
import { useFeatureFlag, useFeatureGate } from './hooks'
import type { FeatureProps } from './types'

/**
 * Client Component for feature flag rendering
 *
 * @example
 * ```tsx
 * 'use client'
 * import { Feature } from '@ops-ai/nextjs-toggly-client'
 *
 * export function Dashboard() {
 *   return (
 *     <Feature
 *       featureKey="new-dashboard"
 *       fallback={<OldDashboard />}
 *       loading={<LoadingSpinner />}
 *     >
 *       <NewDashboard />
 *     </Feature>
 *   )
 * }
 * ```
 */
export function Feature({
  featureKey,
  requirement = 'all',
  negate = false,
  children,
  fallback = null,
  loading = null,
}: FeatureProps): ReactNode {
  const featureKeys = Array.isArray(featureKey) ? featureKey : [featureKey]

  // Use gate hook for multiple keys or single key
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate
  )

  if (isLoading) {
    return loading
  }

  return isAllowed ? children : fallback
}

/**
 * Client Component to render when feature is OFF
 *
 * @example
 * ```tsx
 * 'use client'
 * import { FeatureOff } from '@ops-ai/nextjs-toggly-client'
 *
 * export function MainContent() {
 *   return (
 *     <FeatureOff featureKey="maintenance-mode">
 *       <AppContent />
 *     </FeatureOff>
 *   )
 * }
 * ```
 */
export function FeatureOff({
  featureKey,
  requirement = 'all',
  children,
  fallback = null,
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
 * Client Component for A/B testing / variant rendering
 *
 * @example
 * ```tsx
 * 'use client'
 * import { FeatureVariant } from '@ops-ai/nextjs-toggly-client'
 *
 * export function Checkout() {
 *   return (
 *     <FeatureVariant
 *       featureKey="checkout-v2"
 *       enabled={<NewCheckout />}
 *       disabled={<OldCheckout />}
 *       loading={<CheckoutSkeleton />}
 *     />
 *   )
 * }
 * ```
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

/**
 * Client Component for feature gate with multiple features
 *
 * @example
 * ```tsx
 * 'use client'
 * import { FeatureGate } from '@ops-ai/nextjs-toggly-client'
 *
 * export function AdminPanel() {
 *   return (
 *     <FeatureGate
 *       featureKeys={['admin-access', 'beta-user']}
 *       requirement="all"
 *       fallback={<AccessDenied />}
 *     >
 *       <AdminContent />
 *     </FeatureGate>
 *   )
 * }
 * ```
 */
export function FeatureGate({
  featureKeys,
  requirement = 'all',
  negate = false,
  children,
  fallback = null,
  loading = null,
}: {
  featureKeys: string[]
  requirement?: FeatureRequirement
  negate?: boolean
  children: ReactNode
  fallback?: ReactNode
  loading?: ReactNode
}): ReactNode {
  const { isAllowed, isLoading } = useFeatureGate(
    featureKeys,
    requirement,
    negate
  )

  if (isLoading) {
    return loading
  }

  return isAllowed ? children : fallback
}

/**
 * Client Component that renders different content based on feature state
 *
 * @example
 * ```tsx
 * 'use client'
 * import { FeatureSwitch } from '@ops-ai/nextjs-toggly-client'
 *
 * export function Navigation() {
 *   return (
 *     <FeatureSwitch
 *       featureKey="nav-style"
 *       cases={{
 *         on: <ModernNav />,
 *         off: <ClassicNav />,
 *         loading: <NavSkeleton />,
 *       }}
 *     />
 *   )
 * }
 * ```
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
