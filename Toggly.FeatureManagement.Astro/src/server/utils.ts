/**
 * Toggly Server Utilities for Astro
 * 
 * Helper functions for server-side feature flag evaluation
 */

import type { AstroGlobal } from 'astro';
import type { TogglyClient } from '../types/index.js';

/**
 * Get Toggly client from Astro global
 * 
 * @param Astro - Astro global object
 * @returns TogglyClient instance
 * @throws Error if Toggly client is not initialized
 */
export function getTogglyFromAstroGlobal(Astro: AstroGlobal): TogglyClient {
  if (!Astro.locals.toggly) {
    throw new Error(
      '[Toggly] Client not initialized. Make sure the Toggly integration is added to astro.config.mjs'
    );
  }
  return Astro.locals.toggly;
}

/**
 * Higher-order function for page-level feature gating
 * 
 * @param featureKey - Feature flag key to check
 * @param Astro - Astro global object
 * @returns Boolean indicating if feature is enabled
 */
export async function withFeatureFlag(
  featureKey: string,
  Astro: AstroGlobal
): Promise<boolean> {
  try {
    const toggly = getTogglyFromAstroGlobal(Astro);
    return await toggly.getFlag(featureKey, false);
  } catch (error) {
    console.error(`[Toggly] Error evaluating feature flag "${featureKey}":`, error);
    return false;
  }
}

/**
 * Check if any of the provided feature flags are enabled
 * 
 * @param featureKeys - Array of feature flag keys to check
 * @param Astro - Astro global object
 * @returns Boolean indicating if any feature is enabled
 */
export async function anyFeatureEnabled(
  featureKeys: string[],
  Astro: AstroGlobal
): Promise<boolean> {
  try {
    const toggly = getTogglyFromAstroGlobal(Astro);
    return await toggly.evaluateGate(featureKeys, 'any', false);
  } catch (error) {
    console.error('[Toggly] Error evaluating feature gates:', error);
    return false;
  }
}

/**
 * Check if all of the provided feature flags are enabled
 * 
 * @param featureKeys - Array of feature flag keys to check
 * @param Astro - Astro global object
 * @returns Boolean indicating if all features are enabled
 */
export async function allFeaturesEnabled(
  featureKeys: string[],
  Astro: AstroGlobal
): Promise<boolean> {
  try {
    const toggly = getTogglyFromAstroGlobal(Astro);
    return await toggly.evaluateGate(featureKeys, 'all', false);
  } catch (error) {
    console.error('[Toggly] Error evaluating feature gates:', error);
    return false;
  }
}


