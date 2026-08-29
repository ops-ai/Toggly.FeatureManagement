/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  baseUri: 'https://definitions.toggly.io',
  environment: 'Production',
  refreshInterval: 180000, // 3 minutes
  showFeatureDuringEvaluation: false,
  enableLiveUpdates: true,
} as const

/**
 * Storage keys for localStorage/sessionStorage
 */
export const STORAGE_KEYS = {
  featureFlags: 'toggly_feature_flags',
  identity: 'toggly_identity',
  lastRefresh: 'toggly_last_refresh',
} as const

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  definitions: (baseUri: string, appKey: string, environment: string) =>
    `${baseUri}/evaluated-signed/${appKey}/${environment}`,
} as const
