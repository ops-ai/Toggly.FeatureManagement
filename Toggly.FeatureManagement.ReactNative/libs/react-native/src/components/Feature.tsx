import React, { useState, useEffect, ReactNode } from 'react';
import type { FeatureRequirement } from '@ops-ai/react-native-toggly-core';
import { useTogglyContext } from '../contexts/TogglyContext';

/**
 * Props for the Feature component
 */
export interface FeatureProps {
  /**
   * Single feature key to check
   */
  featureKey?: string;

  /**
   * Multiple feature keys to check
   */
  featureKeys?: string[];

  /**
   * Requirement mode for multiple features
   * @default 'all'
   */
  requirement?: FeatureRequirement;

  /**
   * Whether to negate the result
   * @default false
   */
  negate?: boolean;

  /**
   * Content to show when feature is enabled
   */
  children: ReactNode;

  /**
   * Content to show when feature is disabled
   */
  fallback?: ReactNode;

  /**
   * Content to show while loading
   */
  loading?: ReactNode;
}

/**
 * Feature component for conditional rendering based on feature flags
 *
 * @example
 * ```tsx
 * // Single feature
 * <Feature featureKey="newDashboard">
 *   <NewDashboard />
 * </Feature>
 *
 * // With fallback
 * <Feature featureKey="newDashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </Feature>
 *
 * // Multiple features (all required)
 * <Feature featureKeys={['feature1', 'feature2']} requirement="all">
 *   <FullFeatureComponent />
 * </Feature>
 *
 * // Any of the features
 * <Feature featureKeys={['feature1', 'feature2']} requirement="any">
 *   <PartialFeatureComponent />
 * </Feature>
 *
 * // Negated (show when feature is OFF)
 * <Feature featureKey="maintenance" negate>
 *   <NormalContent />
 * </Feature>
 * ```
 */
export function Feature({
  featureKey,
  featureKeys = [],
  requirement = 'all',
  negate = false,
  children,
  fallback = null,
  loading = null,
}: FeatureProps): React.ReactElement | null {
  const { toggly, isReady } = useTogglyContext();

  const [shouldShow, setShouldShow] = useState<boolean | null>(null);

  // Build gate from props
  const gate = featureKey
    ? [featureKey, ...featureKeys]
    : featureKeys;

  useEffect(() => {
    let mounted = true;

    const evaluate = async () => {
      if (!isReady) return;

      if (gate.length === 0) {
        setShouldShow(true);
        return;
      }

      try {
        const result = await toggly.evaluateFeatureGate(gate, requirement, negate);
        if (mounted) {
          setShouldShow(result);
        }
      } catch {
        if (mounted) {
          setShouldShow(false);
        }
      }
    };

    evaluate();

    // Subscribe to refreshes
    const unsubscribe = isReady
      ? toggly.on('effectiveFlagsChanged', () => {
          evaluate();
        })
      : () => {};

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [toggly, isReady, gate.join(','), requirement, negate]);

  // Show loading state while evaluating
  if (shouldShow === null) {
    if (loading) {
      return <>{loading}</>;
    }
    // Show feature during evaluation if configured
    if (toggly.shouldShowFeatureDuringEvaluation) {
      return <>{children}</>;
    }
    return null;
  }

  // Render based on evaluation result
  return <>{shouldShow ? children : fallback}</>;
}

/**
 * Higher-order component to wrap a component with feature flag checking
 *
 * @example
 * ```tsx
 * const ProtectedComponent = withFeature(MyComponent, {
 *   featureKey: 'newFeature',
 *   fallback: <OldComponent />,
 * });
 *
 * // Use in JSX
 * <ProtectedComponent someProp="value" />
 * ```
 */
export function withFeature<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  featureProps: Omit<FeatureProps, 'children'>
): React.FC<P> {
  return function WithFeatureComponent(props: P) {
    return (
      <Feature {...featureProps}>
        <WrappedComponent {...props} />
      </Feature>
    );
  };
}
