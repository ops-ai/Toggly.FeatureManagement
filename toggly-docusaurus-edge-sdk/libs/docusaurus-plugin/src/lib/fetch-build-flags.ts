/**
 * Server-side flag fetch for static (build-time) gating.
 * Used only from the Docusaurus plugin during `contentLoaded` / `postBuild`.
 */
import type { Flags } from './toggly-client';

export interface BuildFlagFetchOptions {
  baseURI?: string;
  appKey?: string;
  environment?: string;
  flagDefaults?: Record<string, boolean>;
  connectTimeout?: number;
  isDebug?: boolean;
}

interface TogglyApiPayload {
  defs?: Flags;
  [key: string]: unknown;
}

/**
 * Fetch the evaluated flag map from Toggly at build time.
 * Merges `flagDefaults` underneath API values so callers can supply fallbacks.
 */
export async function fetchBuildTimeFlags(
  options: BuildFlagFetchOptions,
): Promise<Flags> {
  const {
    baseURI = 'https://definitions.toggly.io',
    appKey,
    environment = 'Production',
    flagDefaults = {},
    connectTimeout = 5_000,
    isDebug = false,
  } = options;

  const merged: Flags = { ...flagDefaults };

  if (!appKey) {
    if (isDebug) {
      console.warn('[Toggly Plugin] staticGating: TOGGLY_APP_KEY missing; using flagDefaults only');
    }
    return merged;
  }

  const baseUrl = baseURI.replace(/\/$/, '');
  const url = `${baseUrl}/evaluated-signed/${encodeURIComponent(appKey)}/${encodeURIComponent(environment)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), connectTimeout);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Toggly API returned ${response.status}`);
    }

    const payload = (await response.json()) as TogglyApiPayload | Flags;
    const defs = (payload as TogglyApiPayload).defs;
    const apiFlags = (defs ?? payload) as Flags;

    for (const [key, value] of Object.entries(apiFlags)) {
      if (typeof value === 'boolean') {
        merged[key] = value;
      }
    }

    if (isDebug) {
      const enabled = Object.entries(merged).filter(([, v]) => v).length;
      console.log(
        `[Toggly Plugin] staticGating: loaded ${Object.keys(merged).length} flags (${enabled} enabled)`,
      );
    }

    return merged;
  } catch (error) {
    console.error('[Toggly Plugin] staticGating: failed to fetch flags:', error);
    return merged;
  } finally {
    clearTimeout(timer);
  }
}
