/**
 * Feature component for declarative feature flag rendering
 */

import type { ReactNode, ReactElement } from 'react';
import { useFeature, useFeatureGate } from '../hooks';
import type { FeatureRequirement, TogglyEntityContext } from '@ops-ai/remix-toggly-core';

/**
 * Props for Feature component
 */
export interface FeatureProps {
  /** Feature key to check */
  featureKey?: string;
  /** Multiple feature keys to check */
  featureKeys?: string[];
  /** Requirement type when using multiple features */
  requirement?: FeatureRequirement;
  /** Negate the feature check */
  negate?: boolean;
  /** Default value if feature is not found */
  defaultValue?: boolean;
  /** Content to render when feature is enabled */
  children?: ReactNode;
  /** Content to render when feature is disabled */
  fallback?: ReactNode;
  /** Render prop for custom rendering */
  render?: (enabled: boolean) => ReactNode;
  /** Entity context for mixed evaluated-signed gates */
  context?: TogglyEntityContext | Record<string, unknown> | null;
  /** Context kind for registerContext mapper lookup */
  contextKind?: string;
}

/**
 * Feature component for conditional rendering based on feature flags
 *
 * @example
 * // Simple usage
 * <Feature featureKey="new-dashboard">
 *   <NewDashboard />
 * </Feature>
 *
 * @example
 * // With fallback
 * <Feature featureKey="new-dashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </Feature>
 *
 * @example
 * // Multiple features (all required)
 * <Feature featureKeys={["premium", "analytics"]} requirement="all">
 *   <PremiumAnalytics />
 * </Feature>
 *
 * @example
 * // Negated (show when disabled)
 * <Feature featureKey="maintenance-mode" negate>
 *   <MainContent />
 * </Feature>
 *
 * @example
 * // Render prop
 * <Feature featureKey="dark-mode" render={(enabled) => (
 *   <div className={enabled ? 'dark' : 'light'}>Content</div>
 * )} />
 */
export function Feature({
  featureKey,
  featureKeys,
  requirement = 'all',
  negate = false,
  defaultValue = false,
  children,
  fallback = null,
  render,
  context,
  contextKind,
}: FeatureProps): ReactElement | null {
  // Determine which hook to use
  const keys = featureKeys ?? (featureKey ? [featureKey] : []);

  // Use single feature hook for single key, gate hook for multiple
  const singleEnabled = useFeature(keys[0] ?? '', defaultValue, context, contextKind);
  const gateEnabled = useFeatureGate(keys, requirement, false, context, contextKind);

  // Calculate final enabled state
  let enabled: boolean;
  if (keys.length === 0) {
    enabled = defaultValue;
  } else if (keys.length === 1) {
    enabled = singleEnabled;
  } else {
    enabled = gateEnabled;
  }

  // Apply negation
  if (negate) {
    enabled = !enabled;
  }

  // Render prop takes precedence
  if (render) {
    return <>{render(enabled)}</>;
  }

  // Conditional rendering
  return <>{enabled ? children : fallback}</>;
}

/**
 * Props for FeatureEnabled component
 */
export interface FeatureEnabledProps {
  /** Feature key to check */
  featureKey: string;
  /** Default value if feature is not found */
  defaultValue?: boolean;
  /** Content to render when feature is enabled */
  children: ReactNode;
}

/**
 * Component that only renders children when feature is enabled
 *
 * @example
 * <FeatureEnabled featureKey="premium">
 *   <PremiumContent />
 * </FeatureEnabled>
 */
export function FeatureEnabled({
  featureKey,
  defaultValue = false,
  children,
}: FeatureEnabledProps): ReactElement | null {
  const enabled = useFeature(featureKey, defaultValue);
  return enabled ? <>{children}</> : null;
}

/**
 * Props for FeatureDisabled component
 */
export interface FeatureDisabledProps {
  /** Feature key to check */
  featureKey: string;
  /** Default value if feature is not found */
  defaultValue?: boolean;
  /** Content to render when feature is disabled */
  children: ReactNode;
}

/**
 * Component that only renders children when feature is disabled
 *
 * @example
 * <FeatureDisabled featureKey="new-ui">
 *   <LegacyUI />
 * </FeatureDisabled>
 */
export function FeatureDisabled({
  featureKey,
  defaultValue = true,
  children,
}: FeatureDisabledProps): ReactElement | null {
  const enabled = useFeature(featureKey, !defaultValue);
  return !enabled ? <>{children}</> : null;
}

/**
 * Props for FeatureSwitch component
 */
export interface FeatureSwitchProps {
  /** Feature key to check */
  featureKey: string;
  /** Default value if feature is not found */
  defaultValue?: boolean;
  /** Content to render when feature is enabled */
  enabled: ReactNode;
  /** Content to render when feature is disabled */
  disabled: ReactNode;
}

/**
 * Component that renders different content based on feature state
 *
 * @example
 * <FeatureSwitch
 *   featureKey="new-pricing"
 *   enabled={<NewPricing />}
 *   disabled={<OldPricing />}
 * />
 */
export function FeatureSwitch({
  featureKey,
  defaultValue = false,
  enabled,
  disabled,
}: FeatureSwitchProps): ReactElement {
  const isEnabled = useFeature(featureKey, defaultValue);
  return <>{isEnabled ? enabled : disabled}</>;
}

/**
 * Props for FeatureGate component
 */
export interface FeatureGateProps {
  /** Feature keys to check */
  featureKeys: string[];
  /** Requirement type */
  requirement?: FeatureRequirement;
  /** Negate the check */
  negate?: boolean;
  /** Content to render when gate passes */
  children: ReactNode;
  /** Content to render when gate fails */
  fallback?: ReactNode;
}

/**
 * Component for checking multiple features
 *
 * @example
 * <FeatureGate featureKeys={["premium", "beta"]} requirement="all">
 *   <BetaFeature />
 * </FeatureGate>
 */
export function FeatureGate({
  featureKeys,
  requirement = 'all',
  negate = false,
  children,
  fallback = null,
}: FeatureGateProps): ReactElement | null {
  const enabled = useFeatureGate(featureKeys, requirement, negate);
  return <>{enabled ? children : fallback}</>;
}
