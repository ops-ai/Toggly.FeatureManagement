/**
 * Vue integration for Toggly in Astro
 * 
 * Note: Feature.vue is distributed as source and will be compiled by your Astro project
 */

export { useFeatureFlag, useFeatureGate, useVariant } from './composables.js';

// Re-export type for documentation
export interface FeatureProps {
  flag?: string;
  flags?: string[];
  requirement?: 'all' | 'any';
  negate?: boolean;
}

export interface FeatureGateBuilderProps extends FeatureProps {}


