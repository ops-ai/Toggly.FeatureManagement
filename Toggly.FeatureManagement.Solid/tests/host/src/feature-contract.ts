import type { FeatureProps } from '@ops-ai/solid-feature-flags-toggly';

type RequireFalse<T extends false> = T;

// Check the installed package contract, not just the source component's rendering.
export type FeatureHasNoDisabledContentProp = RequireFalse<
  'fallback' extends keyof FeatureProps ? true : false
>;
