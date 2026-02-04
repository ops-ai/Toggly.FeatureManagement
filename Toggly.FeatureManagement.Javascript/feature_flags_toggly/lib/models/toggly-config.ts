import type { Hook } from '@ops-ai/toggly-hooks-types';

export interface TogglyConfig {
  baseURI?: string;
  reloadOnFeatureFlagValidation?: boolean;
  connectTimeout?: number;
  featureFlagsRefreshInterval?: number;
  isDebug?: boolean;

  appKey?: string;
  environment?: string;
  flagDefaults?: { [key: string]: boolean };
  
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[];
}