import type { TogglyServerConfig, TogglyState } from './types.js'

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<
  Pick<
    TogglyServerConfig,
    | 'environment'
    | 'baseUrl'
    | 'refreshInterval'
    | 'timeout'
    | 'debug'
    | 'enableFileCache'
    | 'fileCachePath'
    | 'enableStreaming'
    | 'useEtag'
    | 'verifySignatures'
  >
> = {
  environment: 'Production',
  baseUrl: 'https://definitions.toggly.io',
  refreshInterval: 180000, // 3 minutes
  timeout: 10000, // 10 seconds
  debug: false,
  enableFileCache: false,
  fileCachePath: '.toggly-cache',
  enableStreaming: false,
  useEtag: true,
  verifySignatures: false,
}

/**
 * Initial client state
 */
export const INITIAL_STATE: TogglyState = {
  initialized: false,
  loading: false,
  features: {},
  definitions: new Map(),
  error: null,
  lastRefresh: null,
  etag: null,
  wsConnected: false,
}

/**
 * Cache keys
 */
export const CACHE_KEYS = {
  DEFINITIONS: 'toggly:definitions',
  ETAG: 'toggly:etag',
  IDENTITY: 'toggly:identity',
  JWKS: 'toggly:jwks',
} as const
