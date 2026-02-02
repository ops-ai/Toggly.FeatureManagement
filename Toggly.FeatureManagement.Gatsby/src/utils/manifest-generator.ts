/**
 * Manifest Generator Utility
 * 
 * Generates manifest files for edge worker filtering
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PageFeatureMap, TogglyPluginOptions } from '../types/index.js';

/**
 * Generate toggly-page-features.json manifest
 * 
 * Creates a JSON file mapping page paths to required feature flags
 * 
 * @param publicPath - Path to Gatsby public directory
 * @param pageFeatureMap - Map of page paths to feature keys
 */
export async function generatePageFeaturesManifest(
  publicPath: string,
  pageFeatureMap: PageFeatureMap
): Promise<void> {
  const manifestPath = path.join(publicPath, 'toggly-page-features.json');
  
  try {
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(pageFeatureMap, null, 2),
      'utf-8'
    );
    console.log(`[Toggly] Generated page features manifest: ${manifestPath}`);
  } catch (error) {
    console.error('[Toggly] Failed to generate page features manifest:', error);
    throw error;
  }
}

/**
 * Generate toggly-config.json manifest
 * 
 * Creates a sanitized config file for edge workers (without sensitive data)
 * 
 * @param publicPath - Path to Gatsby public directory
 * @param pluginOptions - Toggly plugin options
 */
export async function generateConfigManifest(
  publicPath: string,
  pluginOptions: TogglyPluginOptions
): Promise<void> {
  const configPath = path.join(publicPath, 'toggly-config.json');
  
  // Sanitized config (no sensitive data)
  const sanitizedConfig = {
    appKey: pluginOptions.appKey,
    environment: pluginOptions.environment || 'Production',
    baseURI: pluginOptions.baseURI || 'https://client.toggly.io',
  };
  
  try {
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(sanitizedConfig, null, 2),
      'utf-8'
    );
    console.log(`[Toggly] Generated config manifest: ${configPath}`);
  } catch (error) {
    console.error('[Toggly] Failed to generate config manifest:', error);
    throw error;
  }
}

/**
 * Generate all manifests
 * 
 * @param publicPath - Path to Gatsby public directory
 * @param pageFeatureMap - Map of page paths to feature keys
 * @param pluginOptions - Toggly plugin options
 */
export async function generateManifests(
  publicPath: string,
  pageFeatureMap: PageFeatureMap,
  pluginOptions: TogglyPluginOptions
): Promise<void> {
  await Promise.all([
    generatePageFeaturesManifest(publicPath, pageFeatureMap),
    generateConfigManifest(publicPath, pluginOptions),
  ]);
}
