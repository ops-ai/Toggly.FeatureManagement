/**
 * Toggly Astro Integration
 * 
 * Provides build-time configuration, frontmatter extraction, and runtime injection
 */

import type { AstroIntegration, AstroConfig } from 'astro';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { TogglyConfig, PageFeatureMapping } from '../types/index.js';
import { createTogglyServerClient } from '../server/toggly-server.js';

export interface TogglyIntegrationOptions extends TogglyConfig {}

/**
 * Toggly Astro Integration
 */
export default function togglyIntegration(
  options: TogglyIntegrationOptions = {}
): AstroIntegration {
  const config: TogglyConfig = {
    baseURI: 'https://client.toggly.io',
    environment: 'Production',
    flagDefaults: {},
    featureFlagsRefreshInterval: 3 * 60 * 1000,
    isDebug: false,
    connectTimeout: 5 * 1000,
    ...options,
  };

  let pageFeatureMapping: PageFeatureMapping = {};
  let astroConfig: AstroConfig;

  return {
    name: '@ops-ai/astro-feature-flags-toggly',
    hooks: {
      'astro:config:setup': async ({ config: cfg, injectScript, updateConfig }) => {
        astroConfig = cfg;

        if (config.isDebug) {
          console.log('[Toggly Integration] Setting up integration...');
        }

        // Inject client setup script
        injectScript(
          'page',
          `
          window.__TOGGLY_CONFIG__ = ${JSON.stringify(config)};
          import('@ops-ai/astro-feature-flags-toggly/client/setup');
        `
        );

        // Add middleware to inject Toggly client into Astro.locals
        updateConfig({
          vite: {
            ssr: {
              noExternal: ['@ops-ai/astro-feature-flags-toggly'],
            },
          },
        });
      },

      'astro:server:setup': async ({ server }) => {
        if (config.isDebug) {
          console.log('[Toggly Integration] Server setup...');
        }

        // Create server client for SSR
        const togglyClient = createTogglyServerClient(config);

        // Inject into server context (this will be available in SSR)
        server.middlewares.use((req, res, next) => {
          // @ts-ignore - Adding toggly to request
          req.togglyClient = togglyClient;
          next();
        });
      },

      'astro:build:start': async () => {
        if (config.isDebug) {
          console.log('[Toggly Integration] Build started, extracting frontmatter...');
        }

        // Extract page feature mapping from frontmatter
        pageFeatureMapping = await extractPageFeatures(astroConfig, config.isDebug);

        if (config.isDebug) {
          console.log(
            `[Toggly Integration] Found ${Object.keys(pageFeatureMapping).length} pages with x-feature`
          );
          Object.entries(pageFeatureMapping).forEach(([route, feature]) => {
            console.log(`  ${route} -> ${feature}`);
          });
        }
      },

      'astro:build:done': async ({ dir }) => {
        if (config.isDebug) {
          console.log('[Toggly Integration] Build done, writing manifest...');
        }

        // Write page feature manifest for edge workers
        const manifestPath = path.join(dir.pathname, 'toggly-page-features.json');
        fs.writeFileSync(manifestPath, JSON.stringify(pageFeatureMapping, null, 2), 'utf-8');

        if (config.isDebug) {
          console.log(`[Toggly Integration] Manifest written to: ${manifestPath}`);
        }

        // Also write config for reference
        const configPath = path.join(dir.pathname, 'toggly-config.json');
        fs.writeFileSync(
          configPath,
          JSON.stringify(
            {
              ...config,
              // Don't expose appKey in public build output
              appKey: config.appKey ? '***' : undefined,
            },
            null,
            2
          ),
          'utf-8'
        );
      },

      'astro:config:done': ({ config: cfg, setAdapter }) => {
        // Store final config
        astroConfig = cfg;

        if (config.isDebug) {
          console.log('[Toggly Integration] Configuration finalized');
        }
      },
    },
  };
}

/**
 * Extract x-feature frontmatter from pages
 */
async function extractPageFeatures(
  astroConfig: AstroConfig,
  isDebug?: boolean
): Promise<PageFeatureMapping> {
  const mapping: PageFeatureMapping = {};

  // Determine source directory
  const srcDir = astroConfig.srcDir?.pathname || path.join(process.cwd(), 'src');
  const pagesDir = path.join(srcDir, 'pages');
  const contentDir = path.join(srcDir, 'content');

  // Check if directories exist
  const dirsToScan: string[] = [];
  if (fs.existsSync(pagesDir)) {
    dirsToScan.push(pagesDir);
  }
  if (fs.existsSync(contentDir)) {
    dirsToScan.push(contentDir);
  }

  if (dirsToScan.length === 0) {
    if (isDebug) {
      console.warn('[Toggly Integration] No pages or content directories found');
    }
    return mapping;
  }

  for (const dir of dirsToScan) {
    // Find all .astro, .md, .mdx files
    const files = await glob('**/*.{astro,md,mdx}', {
      cwd: dir,
      absolute: false,
      ignore: ['node_modules/**', '**/node_modules/**'],
    });

    for (const file of files) {
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Extract frontmatter
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        continue;
      }

      const frontmatter = frontmatterMatch[1];

      // Look for x-feature in frontmatter
      const xFeatureMatch = frontmatter.match(/^x-feature:\s*(.+)$/m);
      if (!xFeatureMatch) {
        continue;
      }

      let featureKey = xFeatureMatch[1].trim();
      // Remove quotes if present
      featureKey = featureKey.replace(/^["']|["']$/g, '');

      // Convert file path to route
      let route = convertFilePathToRoute(file, dir === pagesDir);

      // Prepend base if configured
      const base = astroConfig.base || '/';
      if (base !== '/') {
        route = path.join(base, route).replace(/\\/g, '/');
      }

      mapping[route] = featureKey;
    }
  }

  return mapping;
}

/**
 * Convert file path to Astro route
 */
function convertFilePathToRoute(filePath: string, isPages: boolean): string {
  // Remove file extension
  let route = filePath.replace(/\.(astro|md|mdx)$/, '');

  // Remove numeric prefixes (e.g., 01-intro.md -> intro.md)
  route = route
    .split('/')
    .map((segment) => segment.replace(/^\d+-/, ''))
    .join('/');

  // Handle index files
  if (route.endsWith('/index') || route === 'index') {
    route = route.replace(/\/index$/, '') || '/';
  }

  // Ensure leading slash
  if (!route.startsWith('/')) {
    route = '/' + route;
  }

  // For content collections, prepend with collection name if not pages
  // This is a simplification - Astro content collections have more complex routing

  return route;
}

/**
 * Astro middleware to inject Toggly into locals
 * This should be added to src/middleware.ts in the user's project
 */
export function createTogglyMiddleware(config: TogglyConfig) {
  return async function togglyMiddleware(
    { locals }: { locals: Record<string, any> },
    next: () => Promise<Response>
  ): Promise<Response> {
    // Create or reuse Toggly client
    if (!locals.toggly) {
      locals.toggly = createTogglyServerClient(config);
    }

    return next();
  };
}


