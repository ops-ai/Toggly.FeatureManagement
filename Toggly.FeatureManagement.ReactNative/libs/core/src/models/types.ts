import type { Hook } from '@ops-ai/toggly-hooks-types';
import type { LocalGate } from '@ops-ai/toggly-local-gates';

export type { LocalGate };

/**
 * Feature requirement types allowing "any" or "all" operations
 * when evaluating feature gates with multiple feature keys.
 */
export type FeatureRequirement = 'all' | 'any';

/**
 * Feature flags map - key is the feature name, value is enabled state
 */
export type FeatureFlags = Record<string, boolean>;

/**
 * Storage interface for feature flag caching.
 * Implement this interface to provide custom storage backends.
 */
export interface TogglyStorage {
  /**
   * Get a value from storage
   * @param key Storage key
   * @returns The stored value or null if not found
   */
  get(key: string): Promise<string | null>;

  /**
   * Set a value in storage
   * @param key Storage key
   * @param value Value to store
   */
  set(key: string, value: string): Promise<void>;

  /**
   * Delete a value from storage
   * @param key Storage key
   */
  delete(key: string): Promise<void>;
}

/**
 * Network state interface for connectivity awareness
 */
export interface NetworkState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

/**
 * Network info provider interface
 */
export interface NetworkInfoProvider {
  /**
   * Get current network state
   */
  getState(): Promise<NetworkState>;

  /**
   * Subscribe to network state changes
   * @param listener Callback for network state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: (state: NetworkState) => void): () => void;
}

/**
 * App state type for lifecycle awareness
 */
export type AppStateType = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/**
 * App state provider interface
 */
export interface AppStateProvider {
  /**
   * Get current app state
   */
  getCurrentState(): AppStateType;

  /**
   * Subscribe to app state changes
   * @param listener Callback for app state changes
   * @returns Unsubscribe function
   */
  subscribe(listener: (state: AppStateType) => void): () => void;
}

/**
 * Configuration options for Toggly SDK
 */
export interface TogglyConfig {
  /**
   * Base URI for Toggly API
   * @default 'https://definitions.toggly.io'
   */
  baseURI?: string;

  /**
   * Application key from Toggly.io
   */
  appKey?: string;

  /**
   * Environment name from Toggly.io
   * @default 'Production'
   */
  environment?: string;

  /**
   * Unique user identifier for targeting and rollouts
   */
  identity?: string;

  /**
   * User groups for group-based targeting rules
   */
  groups?: string[];

  /**
   * User claims for User Claims filter evaluation
   */
  claims?: Record<string, string>;

  /**
   * Default feature flag values for offline mode
   */
  featureDefaults?: FeatureFlags;

  /**
   * Whether to show feature content during initial evaluation
   * @default false
   */
  showFeatureDuringEvaluation?: boolean;

  /**
   * Interval in milliseconds for automatic feature flag refresh
   * @default 180000 (3 minutes)
   */
  refreshInterval?: number;

  /**
   * Enable signed definitions for enhanced security
   * @default false
   */
  useSignedDefinitions?: boolean;

  /**
   * Verify signatures on signed responses
   * @default false
   */
  verifySignatures?: boolean;

  /**
   * List of trusted key IDs for signed definitions
   */
  trustedKeyIds?: string[];

  /**
   * Hooks to extend SDK behavior at key lifecycle points
   */
  hooks?: Hook[];

  /**
   * Storage provider for caching feature flags
   */
  storage?: TogglyStorage;

  /**
   * Network info provider for connectivity awareness
   */
  networkInfo?: NetworkInfoProvider;

  /**
   * App state provider for lifecycle awareness
   */
  appState?: AppStateProvider;

  /**
   * Connection timeout in milliseconds
   * @default 10000
   */
  connectTimeout?: number;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  requestTimeout?: number;

  /**
   * Enable WebSocket-based live updates for real-time flag changes.
   * Uses React Native's built-in global WebSocket.
   * When connected, polling is throttled to a 20-minute fallback interval.
   * @default false
   */
  enableLiveUpdates?: boolean;

  /**
   * Device-local gates applied as a read-time AND on worker-evaluated booleans
   */
  localGates?: LocalGate[];

  /**
   * Callback invoked when the SDK falls back because of fetch/cache/storage failures
   */
  onError?: (error: Error) => void;
}

/**
 * Response status from feature flag loading operations
 */
export enum TogglyLoadStatus {
  /** Features were successfully fetched from the server */
  FETCHED = 'fetched',
  /** Features were loaded from cache */
  CACHED = 'cached',
  /** Using default values (offline mode or no app key) */
  DEFAULTS = 'defaults',
  /** An error occurred during fetch */
  ERROR = 'error',
}

/**
 * Response from initialization and refresh operations
 */
export interface TogglyInitResponse {
  /** Status of the load operation */
  status: TogglyLoadStatus;
  /** Error message if status is ERROR */
  error?: string;
  /** Feature flags if available */
  flags?: FeatureFlags;
}

/**
 * Cached feature flags structure with metadata
 */
export interface TogglyFeatureFlagsCache {
  /** User identity associated with these flags */
  identity: string;
  /** Serialized feature flags JSON */
  flags: string;
  /** Timestamp for signed definitions */
  timestamp?: number;
  /** Signature for signed definitions */
  signature?: string;
  /** Key ID for signature verification */
  keyId?: string;
}

/**
 * Feature evaluation context
 */
export interface EvaluationContext {
  /** Feature key(s) being evaluated */
  featureKeys: string[];
  /** Requirement mode */
  requirement: FeatureRequirement;
  /** Whether to negate the result */
  negate: boolean;
}

/**
 * Debug information for troubleshooting
 */
export interface TogglyDebugInfo {
  /** Current user identity */
  identity: string | null;
  /** Application key */
  appKey: string | null;
  /** Current environment */
  environment: string;
  /** Whether signed definitions are enabled */
  useSignedDefinitions: boolean;
  /** Whether the app is in foreground */
  isAppInForeground: boolean;
  /** Refresh interval in milliseconds */
  refreshInterval: number;
  /** Whether the sync service is running */
  syncServiceRunning: boolean;
  /** Whether the WebSocket is currently connected */
  wsConnected: boolean;
  /** Last time features were checked */
  lastChecked: Date | null;
  /** Last time features were synced */
  lastSynced: Date | null;
  /** Current ETag */
  eTag: string | null;
  /** Last error message */
  lastError: string | null;
  /** Current network state */
  networkState: NetworkState | null;
  /** Current app state */
  appState: AppStateType;
}

/**
 * State change handler for when features toggle
 */
export type FeatureStateChangeHandler = (
  featureKey: string,
  previousValue: boolean | undefined,
  newValue: boolean
) => void;

/**
 * Event types emitted by Toggly
 */
export type TogglyEventType =
  | 'initialized'
  | 'refreshed'
  | 'error'
  | 'identityChanged'
  | 'featureChanged'
  | 'effectiveFlagsChanged'
  | 'localGatesChanged'
  | 'networkChanged'
  | 'appStateChanged';

/**
 * Event payload for Toggly events
 */
export interface TogglyEvent {
  type: TogglyEventType;
  timestamp: Date;
  data?: unknown;
}

/**
 * Event listener function
 */
export type TogglyEventListener = (event: TogglyEvent) => void;
