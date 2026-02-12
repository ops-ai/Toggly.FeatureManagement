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
  >
> = {
  environment: 'Production',
  baseUrl: 'https://client.toggly.io',
  refreshInterval: 180000, // 3 minutes
  timeout: 10000, // 10 seconds
  debug: false,
  enableFileCache: false,
  fileCachePath: '.toggly-cache',
  enableStreaming: false,
  useEtag: true,
}

/**
 * Initial client state
 */
export const INITIAL_STATE: TogglyState = {
  initialized: false,
  loading: false,
  features: {},
  error: null,
  lastRefresh: null,
  etag: null,
}

/**
 * Cache keys
 */
export const CACHE_KEYS = {
  DEFINITIONS: 'toggly:definitions',
  ETAG: 'toggly:etag',
  IDENTITY: 'toggly:identity',
} as const
