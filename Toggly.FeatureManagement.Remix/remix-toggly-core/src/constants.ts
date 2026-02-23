/**
 * Constants for Toggly Remix SDK
 */

/** Default base URL for Toggly API */
export const DEFAULT_BASE_URL = 'https://definitions.toggly.io';

/** Default environment name */
export const DEFAULT_ENVIRONMENT = 'Production';

/** Default request timeout in milliseconds */
export const DEFAULT_TIMEOUT = 10000;

/** Cookie/storage key names */
export const STORAGE_KEYS = {
  /** Identity cookie/storage key */
  IDENTITY: 'toggly_identity',
  /** Feature flags cache key */
  FLAGS: 'toggly_flags',
  /** Config cache key */
  CONFIG: 'toggly_config',
  /** Last fetch timestamp key */
  LAST_FETCH: 'toggly_last_fetch',
} as const;

/** HTTP header names */
export const HEADERS = {
  /** Identity header */
  IDENTITY: 'x-toggly-identity',
  /** Feature flags header */
  FLAGS: 'x-toggly-flags',
  /** Cache control */
  CACHE_CONTROL: 'cache-control',
} as const;

/** Feature requirement types */
export const REQUIREMENT = {
  ALL: 'all' as const,
  ANY: 'any' as const,
};

/** Error codes */
export const ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONFIG_ERROR: 'CONFIG_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

/** Meta key for loader data */
export const TOGGLY_LOADER_KEY = '__toggly' as const;
