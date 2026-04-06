import type { Hook } from '@ops-ai/toggly-hooks-types';

export interface TogglyConfig {
  baseURI?: string;
  verifySignatures?: boolean;
  reloadOnFeatureFlagValidation?: boolean;
  connectTimeout?: number;
  featureFlagsRefreshInterval?: number;
  isDebug?: boolean;

  appKey?: string;
  environment?: string;
  flagDefaults?: { [key: string]: boolean };
  
  /** Hooks to extend SDK behavior at key lifecycle points */
  hooks?: Hook[];

  /** Enable live updates via WebSocket. Defaults to true if not set. */
  enableLiveUpdates?: boolean;

  /** Enable localStorage caching of definitions. Default: true. Set false for SSR-only or privacy-sensitive contexts. */
  persistCache?: boolean;

  /** Enable variant support. When true, fetches from /evaluated-variants-signed instead of /evaluated-signed. Default: false. */
  enableVariants?: boolean;
}