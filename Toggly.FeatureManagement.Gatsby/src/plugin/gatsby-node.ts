/**
 * Gatsby Node APIs
 * 
 * Build-time hooks for Toggly plugin
 */

import * as path from 'path';
import type { GatsbyNode } from 'gatsby';
import type { TogglyPluginOptions, PageFeatureMap } from '../types/index.js';
import {
  extractFeatureFromPage,
  normalizePagePath,
} from '../utils/frontmatter-extractor.js';
import { generateManifests } from '../utils/manifest-generator.js';

// Store page-to-feature mapping during build
const pageFeatureMap: PageFeatureMap = {};

/**
 * Validate plugin options
 */
export const onPreBootstrap: GatsbyNode['onPreBootstrap'] = ({ reporter }, pluginOptions) => {
  const options = pluginOptions as unknown as TogglyPluginOptions;

  if (!options.appKey) {
    reporter.warn(
      '[Toggly] No appKey provided. Feature flags will use flagDefaults only.'
    );
  }

  if (options.isDebug) {
    reporter.info('[Toggly] Debug mode enabled');
    reporter.info(`[Toggly] Configuration: ${JSON.stringify(options, null, 2)}`);
  }
};

/**
 * Extract feature flags from pages
 */
export const onCreatePage: GatsbyNode['onCreatePage'] = async (
  { page, actions },
  pluginOptions
) => {
  const { createPage, deletePage } = actions;
  const options = pluginOptions as unknown as TogglyPluginOptions;

  // Extract feature from page
  const featureKey = extractFeatureFromPage(page);

  if (featureKey) {
    const normalizedPath = normalizePagePath(page.path);
    
    // Store in map
    pageFeatureMap[normalizedPath] = featureKey;

    if (options.isDebug) {
      console.log(`[Toggly] Page ${normalizedPath} requires feature: ${featureKey}`);
    }

    // Add feature to page context for SSR use
    deletePage(page);
    createPage({
      ...page,
      context: {
        ...page.context,
        togglyFeature: featureKey,
      },
    });
  }
};

/**
 * Generate manifests after build
 */
export const onPostBuild: GatsbyNode['onPostBuild'] = async (
  { store, reporter },
  pluginOptions
) => {
  const options = pluginOptions as unknown as TogglyPluginOptions;
  const { program } = store.getState();
  const publicPath = path.join(program.directory, 'public');

  reporter.info('[Toggly] Generating feature flag manifests...');

  try {
    await generateManifests(publicPath, pageFeatureMap, options);
    
    const pageCount = Object.keys(pageFeatureMap).length;
    reporter.success(
      `[Toggly] Generated manifests for ${pageCount} feature-gated page(s)`
    );

    if (options.isDebug) {
      reporter.info(`[Toggly] Page feature map: ${JSON.stringify(pageFeatureMap, null, 2)}`);
    }
  } catch (error) {
    reporter.error('[Toggly] Failed to generate manifests:', error as Error);
  }
};

/**
 * Add plugin options to schema for GraphQL type safety
 */
export const pluginOptionsSchema: GatsbyNode['pluginOptionsSchema'] = ({ Joi }) => {
  return Joi.object({
    appKey: Joi.string()
      .required()
      .description('Application key from Toggly dashboard'),
    environment: Joi.string()
      .default('Production')
      .description('Environment name'),
    baseURI: Joi.string()
      .default('https://definitions.toggly.io')
      .description('Base URI for Toggly API'),
    verifySignatures: Joi.boolean()
      .default(false)
      .description('Verify ES256 signed envelopes via JWKS'),
    allowedKeyIds: Joi.array()
      .items(Joi.string())
      .optional()
      .description('Optional allow-list of JWKS kid values when verifySignatures is enabled'),
    maxSignatureAgeSeconds: Joi.number()
      .integer()
      .optional()
      .description('Reject envelopes older than this many seconds; unset or <= 0 disables freshness checks'),
    flagDefaults: Joi.object()
      .pattern(Joi.string(), Joi.boolean())
      .default({})
      .description('Default flag values'),
    featureFlagsRefreshInterval: Joi.number()
      .integer()
      .min(0)
      .default(180000)
      .description('Refresh interval in milliseconds'),
    enableLiveUpdates: Joi.boolean()
      .default(true)
      .description('Enable WebSocket live updates in the browser client'),
    allFeaturesEnabledDuringBuild: Joi.boolean()
      .default(false)
      .description('Enable all features during build'),
    identity: Joi.string()
      .optional()
      .description('User identity for targeting'),
    groups: Joi.array()
      .items(Joi.string())
      .optional()
      .description('User groups for targeting'),
    claims: Joi.object()
      .pattern(Joi.string(), Joi.string())
      .optional()
      .description('Custom claims for targeting'),
    isDebug: Joi.boolean()
      .default(false)
      .description('Enable debug logging'),
    connectTimeout: Joi.number()
      .integer()
      .min(0)
      .default(5000)
      .description('Connection timeout in milliseconds'),
  });
};
