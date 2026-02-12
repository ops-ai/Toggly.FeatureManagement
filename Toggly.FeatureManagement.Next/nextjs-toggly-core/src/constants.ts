/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  baseUri: 'https://client.toggly.io',
  environment: 'Production',
  refreshInterval: 180000, // 3 minutes
  showFeatureDuringEvaluation: false,
} as const

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  definitions: (baseUri: string, appKey: string, environment: string) =>
    `${baseUri}/${appKey}-${environment}/defs`,
} as const
