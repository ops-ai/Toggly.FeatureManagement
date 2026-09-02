/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  baseUri: 'https://definitions.toggly.io',
  environment: 'Production',
  refreshInterval: 180000, // 3 minutes
  showFeatureDuringEvaluation: false,
} as const

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  evaluatedSigned: (baseUri: string, appKey: string, environment: string) =>
    `${baseUri}/evaluated-signed/${appKey}/${environment}`,
  definitionsSigned: (baseUri: string, appKey: string, environment: string) =>
    `${baseUri}/definitions-signed/${appKey}/${environment}`,
  /** @deprecated use evaluatedSigned — kept for back-compat */
  definitions: (baseUri: string, appKey: string, environment: string) =>
    API_ENDPOINTS.evaluatedSigned(baseUri, appKey, environment),
} as const
