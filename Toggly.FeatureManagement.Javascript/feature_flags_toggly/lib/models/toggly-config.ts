import type { Hook } from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from './local-gate';

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

  /**
   * Max identity-scoped cache keys (flags/variants) retained in localStorage.
   * Omit or null = unlimited. A positive integer enables LRU eviction by last access.
   */
  maxCacheKeys?: number | null;

  /** Enable variant support. When true, fetches from /evaluated-variants-signed instead of /evaluated-signed. Default: false. */
  enableVariants?: boolean;

  /** Device-local gates applied as a read-time AND on worker-evaluated booleans */
  localGates?: LocalGate[];

  /** Optional SDK error callback for reporting fetch/cache/evaluation failures. */
  onError?: (message: string, error?: unknown) => void;
}