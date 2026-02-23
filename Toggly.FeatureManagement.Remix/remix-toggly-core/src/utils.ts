/**
 * Utility functions for Toggly Remix SDK
 */

import type {
  FeatureFlags,
  FeatureRequirement,
  EvaluationResult,
  TogglyConfig,
} from './types';

/**
 * Default Toggly configuration
 */
export const DEFAULT_CONFIG: Required<
  Pick<TogglyConfig, 'baseUrl' | 'environment' | 'timeout' | 'debug'>
> = {
  baseUrl: 'https://definitions.toggly.io',
  environment: 'Production',
  timeout: 10000,
  debug: false,
};

/**
 * Merge user config with defaults
 */
export function mergeConfig(config: TogglyConfig): TogglyConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

/**
 * Build the feature definitions URL
 */
export function buildDefinitionsUrl(
  config: TogglyConfig,
  identity?: string
): string {
  const { baseUrl, appKey, environment } = mergeConfig(config);

  if (!appKey) {
    throw new Error('appKey is required');
  }

  let url = `${baseUrl}/evaluated-signed/${appKey}/${environment}`;

  if (identity) {
    url += `?u=${encodeURIComponent(identity)}`;
  }

  return url;
}

/**
 * Evaluate a single feature
 */
export function isFeatureEnabled(
  flags: FeatureFlags,
  featureKey: string,
  defaultValue = false
): boolean {
  if (!flags || Object.keys(flags).length === 0) {
    return defaultValue;
  }

  return flags[featureKey] ?? defaultValue;
}

/**
 * Evaluate multiple features with requirement
 */
export function evaluateFeatureGate(
  flags: FeatureFlags,
  featureKeys: string[],
  requirement: FeatureRequirement = 'all',
  negate = false,
  defaultValue = false
): EvaluationResult {
  if (!flags || Object.keys(flags).length === 0) {
    return {
      enabled: negate ? !defaultValue : defaultValue,
      featureKeys,
      requirement,
      negated: negate,
    };
  }

  if (featureKeys.length === 0) {
    return {
      enabled: negate ? false : true,
      featureKeys,
      requirement,
      negated: negate,
    };
  }

  let enabled: boolean;

  if (requirement === 'any') {
    enabled = featureKeys.some((key) => flags[key] === true);
  } else {
    enabled = featureKeys.every((key) => flags[key] === true);
  }

  if (negate) {
    enabled = !enabled;
  }

  return {
    enabled,
    featureKeys,
    requirement,
    negated: negate,
  };
}

/**
 * Normalize feature keys from options
 */
export function normalizeFeatureKeys(
  featureKey?: string,
  featureKeys?: string[]
): string[] {
  const keys: string[] = [];

  if (featureKey) {
    keys.push(featureKey);
  }

  if (featureKeys && Array.isArray(featureKeys)) {
    keys.push(...featureKeys);
  }

  return [...new Set(keys)]; // Remove duplicates
}

/**
 * Create a debug logger
 */
export function createLogger(debug: boolean) {
  return {
    debug: (...args: unknown[]) => {
      if (debug) {
        console.debug('[Toggly]', ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (debug) {
        console.info('[Toggly]', ...args);
      }
    },
    warn: (...args: unknown[]) => {
      console.warn('[Toggly]', ...args);
    },
    error: (...args: unknown[]) => {
      console.error('[Toggly]', ...args);
    },
  };
}

/**
 * Parse identity from various sources (cookie value, header, etc.)
 */
export function parseIdentity(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  // Try to parse as JSON (in case it's a stringified object)
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      // Look for common identity fields
      return parsed.identity || parsed.id || parsed.userId || parsed.sub;
    }
  } catch {
    // Not JSON, use as-is
  }

  return value;
}

/**
 * Serialize feature flags for transport
 */
export function serializeFlags(flags: FeatureFlags): string {
  return JSON.stringify(flags);
}

/**
 * Deserialize feature flags from transport
 */
export function deserializeFlags(value: string | null | undefined): FeatureFlags {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as FeatureFlags;
    }
  } catch {
    // Invalid JSON
  }

  return {};
}

/**
 * Check if we're running on the server
 */
export function isServer(): boolean {
  return !isClient();
}

/**
 * Check if we're running on the client
 */
export function isClient(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
  );
}

/**
 * Create a timeout promise
 */
export function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);
  });
}

/**
 * Fetch with timeout
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}
