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
  /** Negate the feature check — use for the off path (same as .NET `<feature negate>`) */
  negate?: boolean;
  /** Default value if feature is not found */
  defaultValue?: boolean;
  /** Content to render when the gate passes */
  children?: ReactNode;
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
 * // Off path with negate
 * <Feature featureKey="maintenance-mode" negate>
 *   <MainContent />
 * </Feature>
 *
 * @example
 * // Multiple features (all required)
 * <Feature featureKeys={["premium", "analytics"]} requirement="all">
 *   <PremiumAnalytics />
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

  // Conditional rendering — off path uses a separate Feature with negate
  return enabled ? <>{children}</> : null;
}

/**
 * Props for FeatureEnabled component.
 * Component is deprecated — prefer `<Feature featureKey="…">`.
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
 * @deprecated Use `<Feature featureKey="…">` instead
 *
 * @example
 * <Feature featureKey="premium">
 *   <PremiumContent />
 * </Feature>
 */
export function FeatureEnabled({
  featureKey,
  defaultValue = false,
  children,
}: Readonly<FeatureEnabledProps>): ReactElement | null {
  return (
    <Feature featureKey={featureKey} defaultValue={defaultValue}>
      {children}
    </Feature>
  );
}

/**
 * Props for FeatureDisabled component.
 * Component is deprecated — prefer `<Feature featureKey="…" negate>`.
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
 * @deprecated Use `<Feature featureKey="…" negate>` instead
 *
 * @example
 * <Feature featureKey="new-ui" negate>
 *   <LegacyUI />
 * </Feature>
 */
export function FeatureDisabled({
  featureKey,
  defaultValue = true,
  children,
}: Readonly<FeatureDisabledProps>): ReactElement | null {
  return (
    <Feature featureKey={featureKey} defaultValue={!defaultValue} negate>
      {children}
    </Feature>
  );
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
  /** Entity context for mixed evaluated-signed gates */
  context?: TogglyEntityContext | Record<string, unknown> | null;
  /** Context kind for registerContext mapper lookup */
  contextKind?: string;
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
  context,
  contextKind,
}: FeatureGateProps): ReactElement | null {
  const enabled = useFeatureGate(featureKeys, requirement, negate, context, contextKind);
  return enabled ? <>{children}</> : null;
}
