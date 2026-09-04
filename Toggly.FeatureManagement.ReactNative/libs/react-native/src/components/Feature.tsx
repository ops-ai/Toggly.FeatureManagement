import React, { useState, useEffect, ReactNode } from 'react';
import type { FeatureRequirement, TogglyEntityContext } from '@ops-ai/react-native-toggly-core';
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
   * Whether to negate the result — use for the off path (same as .NET `<feature negate>`)
   * @default false
   */
  negate?: boolean;

  /**
   * Entity instance or canonical entity context for entity-gated flags
   */
  context?: TogglyEntityContext | Record<string, unknown> | null;

  /**
   * Context kind for registerContext mapper lookup when `context` is a domain object
   */
  contextKind?: string;

  /**
   * Content to show when the gate passes
   */
  children: ReactNode;

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
 * // Off path with negate
 * <Feature featureKey="maintenance" negate>
 *   <NormalContent />
 * </Feature>
 *
 * // Multiple features (all required)
 * <Feature featureKeys={['feature1', 'feature2']} requirement="all">
 *   <FullFeatureComponent />
 * </Feature>
 *
 * // Entity context
 * <Feature featureKey="OrderBadge" context={order} contextKind="Order">
 *   <Badge />
 * </Feature>
 * ```
 */
export function Feature({
  featureKey,
  featureKeys = [],
  requirement = 'all',
  negate = false,
  context,
  contextKind,
  children,
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
        const result = await toggly.evaluateFeatureGate(
          gate,
          requirement,
          negate,
          context,
          contextKind,
        );
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
  }, [toggly, isReady, gate.join(','), requirement, negate, context, contextKind]);

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

  // Render based on evaluation result — off path uses a separate Feature with negate
  return shouldShow ? <>{children}</> : null;
}

/**
 * Higher-order component to wrap a component with feature flag checking
 *
 * @example
 * ```tsx
 * const ProtectedComponent = withFeature(MyComponent, {
 *   featureKey: 'newFeature',
 * });
 *
 * // Off path
 * const LegacyComponent = withFeature(OldComponent, {
 *   featureKey: 'newFeature',
 *   negate: true,
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
