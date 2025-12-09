/**
 * @ops-ai/toggly-docusaurus-plugin - Docusaurus plugin and React bindings
 *
 * Provides Docusaurus plugin integration and React components/hooks
 * for gating documentation content with Toggly feature flags.
 */

import type { Plugin, LoadContext, PluginContentLoadedActions } from '@docusaurus/types';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import webpack from 'webpack';

export interface TogglyPluginOptions {
  /** Base URI for the Toggly API (default: 'https://client.toggly.io') */
  baseURI?: string;
  /** Application key from Toggly */
  appKey?: string;
  /** Environment name (e.g., 'Production', 'Staging') (default: 'Production') */
  environment?: string;
  /** Default flag values to use when API is unavailable */
  flagDefaults?: { [key: string]: boolean };
  /** Feature flags refresh interval in milliseconds (default: 180000 = 3 minutes) */
  featureFlagsRefreshInterval?: number;
  /** Enable debug logging (default: false) */
  isDebug?: boolean;
  /** Connection timeout in milliseconds (default: 5000) */
  connectTimeout?: number;
  /** User identity for targeting (optional) */
  identity?: string;
}

interface PageFeatureMapping {
  [routePath: string]: string;
}

interface DocMetadata {
  id: string;
  title: string;
  description?: string;
  source: string;
  sourceDirName: string;
  sidebarPosition?: number;
  frontMatter: {
    [key: string]: unknown;
  };
  permalink: string;
}

/**
 * Docusaurus plugin for Toggly feature flag gating
 */
export default function togglyPlugin(
  context: LoadContext,
  options: TogglyPluginOptions
): Plugin {
  const {
    baseURI = 'https://client.toggly.io',
    appKey,
    environment = 'Production',
    flagDefaults = {},
    featureFlagsRefreshInterval = 3 * 60 * 1000,
    isDebug = false,
    connectTimeout = 5 * 1000,
    identity,
  } = options;

  // Store page feature mapping for postBuild
  let pageFeatureMapping: PageFeatureMapping = {};

  return {
    name: 'toggly-plugin',

    /**
     * Load content: Extract x-feature frontmatter from docs
     * We'll access doc metadata through the content system
     */
    async loadContent() {
      return {
        config: {
          baseURI,
          appKey,
          environment,
          flagDefaults,
          featureFlagsRefreshInterval,
          isDebug,
          connectTimeout,
          identity,
        },
      };
    },

    /**
     * Content loaded: Extract x-feature from doc metadata and build route mapping
     */
    async contentLoaded({ content, actions }) {
      try {
        const { config: pluginConfig } = content as {
          config: TogglyPluginOptions;
        };

        // Extract page feature mapping from files
        // We parse files directly to get x-feature frontmatter
        // and will map to routes using Docusaurus's routing structure
        pageFeatureMapping = await extractFromFiles(context);

        // Store data for configureWebpack and postBuild
        (this as any).__togglyPluginData = {
          pageFeatureMapping,
          config: pluginConfig,
        };

        if (isDebug) {
          console.log(
            `[Toggly Plugin] Found ${Object.keys(pageFeatureMapping).length} pages with x-feature frontmatter`
          );
          if (Object.keys(pageFeatureMapping).length > 0) {
            console.log('[Toggly Plugin] Page feature mappings:');
            Object.entries(pageFeatureMapping).forEach(([route, feature]) => {
              console.log(`  ${route} -> ${feature}`);
            });
          }
        }
      } catch (error) {
        console.error('[Toggly Plugin] Error in contentLoaded:', error);
        // Store empty data to prevent further errors
        (this as any).__togglyPluginData = {
          pageFeatureMapping: {},
          config: options,
        };
      }
    },

    /**
     * Post build: Write manifest to output directory
     */
    async postBuild({ outDir }) {
      const pluginData = (this as any).__togglyPluginData;
      if (!pluginData) {
        return;
      }

      const { pageFeatureMapping: mapping } = pluginData;
      
      // Write manifest to build output directory
      const manifestPath = path.join(outDir, 'toggly-page-features.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(mapping, null, 2),
        'utf-8'
      );

      if (isDebug) {
        console.log(
          `[Toggly Plugin] Generated page feature manifest: ${manifestPath}`
        );
      }
    },

    /**
     * Configure Webpack: Inject Toggly config into client bundle
     */
    configureWebpack(config, isServer) {
      if (isServer) {
        return {};
      }

      // Get stored data from contentLoaded
      const pluginData = (this as any).__togglyPluginData;
      if (!pluginData) {
        return {};
      }

      const { pageFeatureMapping, config: pluginConfig } = pluginData;

      return {
        plugins: [
          new webpack.DefinePlugin({
            __TOGGLY_CONFIG__: JSON.stringify(pluginConfig),
            __TOGGLY_PAGE_FEATURES__: JSON.stringify(pageFeatureMapping),
          }),
        ],
      };
    },

    /**
     * Inject HTML tags: Add script to make config available globally
     */
    injectHtmlTags() {
      const pluginData = (this as any).__togglyPluginData;
      if (!pluginData) {
        return {};
      }

      const { config: pluginConfig } = pluginData;

      return {
        headTags: [
          {
            tagName: 'script',
            innerHTML: `window.__TOGGLY_CONFIG__ = ${JSON.stringify(pluginConfig)};`,
          },
        ],
      };
    },

    /**
     * Get client modules: Import the client setup module
     */
    getClientModules() {
      // Return path relative to the dist directory
      // Both index.js and client/setup.js are in dist/
      return [path.resolve(__dirname, './client/setup')];
    },
  };
}


/**
 * Extract page feature mapping by parsing files directly
 * Maps file paths to Docusaurus route paths
 */
async function extractFromFiles(context: LoadContext): Promise<PageFeatureMapping> {
  const { siteDir, baseUrl } = context;
  const docsDir = path.join(siteDir, 'docs');
  const pageFeatureMapping: PageFeatureMapping = {};

  // Check if docs directory exists
  if (!fs.existsSync(docsDir)) {
    return pageFeatureMapping;
  }

  // Find all MD/MDX files in the docs directory
  const files = await glob('**/*.{md,mdx}', {
    cwd: docsDir,
    absolute: false,
    ignore: ['node_modules/**'],
  });

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // Extract x-feature property (supports YAML with or without quotes)
      const xFeatureMatch = frontmatter.match(/^x-feature:\s*(.+)$/m);
      if (xFeatureMatch) {
        let featureKey = xFeatureMatch[1].trim();
        // Remove quotes if present
        featureKey = featureKey.replace(/^["']|["']$/g, '');

        // Convert file path to Docusaurus route path
        // Docusaurus routes docs as: /docs/<path>
        // File structure: docs/<category>/<file>.md -> /docs/<category>/<file>
        let routePath = file.replace(/\.(md|mdx)$/, '').replace(/\\/g, '/');

        // Handle index files - they become the parent directory route
        if (path.basename(routePath) === 'index') {
          routePath = path.dirname(routePath);
          if (routePath === '.') {
            routePath = '';
          }
        }

        // Ensure path starts with /
        if (!routePath.startsWith('/')) {
          routePath = '/' + routePath;
        }

        // Prepend /docs/ if not already there
        if (!routePath.startsWith('/docs')) {
          routePath = '/docs' + routePath;
        }

        // Remove trailing slash (except for root /docs)
        routePath = routePath.replace(/\/$/, '') || '/docs';

        // Prepend baseUrl if not root
        // baseUrl is typically '/' but can be '/project-name/' for GitHub Pages
        let fullRoutePath = routePath;
        if (baseUrl !== '/') {
          const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
          fullRoutePath = normalizedBaseUrl + routePath;
        }

        pageFeatureMapping[fullRoutePath] = featureKey;
      }
    }
  }

  return pageFeatureMapping;
}

// Export React components and hooks
export { TogglyProvider, useToggly, useFlag, Feature } from './client';
export type {
  TogglyProviderProps,
  TogglyContextValue,
  FeatureProps,
} from './client';
