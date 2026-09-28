/**
 * Toggly Astro Integration
 * 
 * Provides build-time configuration, frontmatter extraction, and runtime injection
 */

import type { AstroIntegration, AstroConfig } from 'astro';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { TogglyConfig, PageFeatureMapping } from '../types/index.js';
import { createTogglyServerClient } from '../server/toggly-server.js';
import { REQUEST_SCOPED_CLOSE_TIMEOUT_MS } from '../telemetry/runtime.js';

export interface TogglyIntegrationOptions extends TogglyConfig {
  /** Browser usage/check/view policy; omitted inherits enableUsageTracking. */
  browserEnableUsageTracking?: boolean;
  /** Browser business metrics policy; omitted inherits enableMetrics. */
  browserEnableMetrics?: boolean;
}

interface FrontmatterBlock {
  opener: string;
  content: string;
  closer: string;
  whole: string;
}

function extractFrontmatter(source: string): FrontmatterBlock | null {
  const openerEnd = source.indexOf('\n');
  if (openerEnd === -1 || !/^---\s*$/.test(source.slice(0, openerEnd))) {
    return null;
  }

  const closerStart = source.indexOf('\n---', openerEnd + 1);
  if (closerStart === -1) {
    return null;
  }

  const closerEnd = closerStart + 4;
  return {
    opener: source.slice(0, openerEnd + 1),
    content: source.slice(openerEnd + 1, closerStart),
    closer: source.slice(closerStart, closerEnd),
    whole: source.slice(0, closerEnd),
  };
}

function readFeatureKey(frontmatter: string): string | null {
  for (const line of frontmatter.split('\n')) {
    if (!line.startsWith('x-feature:')) {
      continue;
    }
    const featureKey = line.slice('x-feature:'.length).trim();
    return featureKey || null;
  }
  return null;
}

function removeFeatureDirective(frontmatter: string): string {
  let lineStart = 0;
  while (lineStart < frontmatter.length) {
    const lineEnd = frontmatter.indexOf('\n', lineStart);
    const end = lineEnd === -1 ? frontmatter.length : lineEnd;
    if (frontmatter.slice(lineStart, end).startsWith('x-feature:')) {
      return frontmatter.slice(0, lineStart) + frontmatter.slice(end + 1);
    }
    if (lineEnd === -1) {
      return frontmatter;
    }
    lineStart = lineEnd + 1;
  }
  return frontmatter;
}

function featureDirectories(astroConfig: AstroConfig): { pagesDir: string; directories: string[] } {
  const srcDir = astroConfig.srcDir?.pathname || path.join(process.cwd(), 'src');
  const pagesDir = path.join(srcDir, 'pages');
  const contentDir = path.join(srcDir, 'content');
  return {
    pagesDir,
    directories: [pagesDir, contentDir].filter(directory => fs.existsSync(directory)),
  };
}

function withBaseRoute(route: string, base: string): string {
  return base === '/' ? route : path.join(base, route).replaceAll('\\', '/');
}

function featureMappingForFile(
  directory: string,
  file: string,
  pagesDir: string,
  base: string,
): [string, string] | undefined {
  const content = fs.readFileSync(path.join(directory, file), 'utf-8');
  const frontmatter = extractFrontmatter(content);
  const featureKey = frontmatter && readFeatureKey(frontmatter.content);
  if (!featureKey) return undefined;

  const route = withBaseRoute(convertFilePathToRoute(file, directory === pagesDir), base);
  return [route, featureKey.replaceAll(/(^["'])|(["']$)/g, '')];
}

async function extractDirectoryFeatures(
  directory: string,
  pagesDir: string,
  base: string,
): Promise<PageFeatureMapping> {
  const mapping: PageFeatureMapping = {};
  const files = await glob('**/*.{astro,md,mdx}', {
    cwd: directory,
    absolute: false,
    ignore: ['node_modules/**', '**/node_modules/**'],
  });

  for (const file of files) {
    const feature = featureMappingForFile(directory, file, pagesDir, base);
    if (feature) mapping[feature[0]] = feature[1];
  }
  return mapping;
}

/**
 * Toggly Astro Integration
 */
export default function togglyIntegration(
  options: TogglyIntegrationOptions = {}
): AstroIntegration {
  const { browserEnableUsageTracking, browserEnableMetrics, ...sharedOptions } = options;
  const config: TogglyConfig = {
    baseURI: 'https://definitions.toggly.io',
    environment: 'Production',
    flagDefaults: {},
    featureFlagsRefreshInterval: 3 * 60 * 1000,
    isDebug: false,
    connectTimeout: 5 * 1000,
    allFeaturesEnabledDuringBuild: false,
    enableVariants: false,
    ...sharedOptions,
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
        // For client-side, we never want allFeaturesEnabledDuringBuild since that's only for SSG
        const clientConfig: TogglyConfig = {
          ...config,
          allFeaturesEnabledDuringBuild: false,
          enableUsageTracking: browserEnableUsageTracking ?? config.enableUsageTracking,
          enableMetrics: browserEnableMetrics ?? config.enableMetrics,
        };
        injectScript(
          'page',
          `
          window.__TOGGLY_CONFIG__ = ${JSON.stringify(clientConfig)};
          import('@ops-ai/astro-feature-flags-toggly/client/setup');
        `
        );

        // Add Vite plugin to strip x-feature directives before Astro's compiler
        updateConfig({
          vite: {
            // Source Vue/Svelte components import the same store as client setup.
            // Prebundling only the JS entry points creates a second store in dev.
            optimizeDeps: { exclude: ['@ops-ai/astro-feature-flags-toggly'] },
            ssr: {
              noExternal: ['@ops-ai/astro-feature-flags-toggly'],
            },
            plugins: [
              {
                name: 'toggly-x-feature-transform',
                enforce: 'pre' as const,
                load(id: string) {
                  // Vite 7/8 may append query/hash (e.g. file.astro?astro&type=script).
                  const filePath = id.split('?', 1)[0].split('#', 1)[0];
                  if (!filePath.endsWith('.astro')) return null;
                  if (!fs.existsSync(filePath)) return null;

                  const code = fs.readFileSync(filePath, 'utf-8');

                  // Check if frontmatter contains x-feature:
                  const frontmatter = extractFrontmatter(code);
                  if (!frontmatter) return null;

                  if (!readFeatureKey(frontmatter.content)) return null;

                  // Strip the x-feature line entirely so esbuild doesn't choke on it
                  const updatedFrontmatter = removeFeatureDirective(frontmatter.content);

                  return code.replace(
                    frontmatter.whole,
                    frontmatter.opener + updatedFrontmatter + frontmatter.closer
                  );
                },
              },
            ],
          },
        });
      },

      'astro:server:setup': async ({ server }) => {
        if (config.isDebug) {
          console.log('[Toggly Integration] Server setup...');
        }

        // Create server client for SSR/dev server
        // In dev mode, we don't enable all features - we use actual flags
        const togglyClient = createTogglyServerClient(config, false);

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

        // If allFeaturesEnabledDuringBuild is true, create a build-time client
        // that will override all flags to true
        if (config.allFeaturesEnabledDuringBuild) {
          if (config.isDebug) {
            console.log('[Toggly Integration] Build mode: All features will be enabled');
          }
          // Create a build-time client that enables all features.
          createTogglyServerClient(config, true);
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
  const { pagesDir, directories } = featureDirectories(astroConfig);
  if (directories.length === 0) {
    if (isDebug) {
      console.warn('[Toggly Integration] No pages or content directories found');
    }
    return {};
  }

  const mapping: PageFeatureMapping = {};
  const base = astroConfig.base || '/';
  for (const directory of directories) {
    Object.assign(mapping, await extractDirectoryFeatures(directory, pagesDir, base));
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
 *
 * Creates a request-scoped server client (process handlers off, no flush timer
 * by default) and closes it when the request finishes so usage telemetry does
 * not accumulate Node listeners or intervals across requests.
 */
export function createTogglyMiddleware(config: TogglyConfig) {
  return async function togglyMiddleware(
    { locals }: { locals: Record<string, any> },
    next: () => Promise<Response>
  ): Promise<Response> {
    // Create or reuse Toggly client
    // In middleware (runtime), we never enable all features - we use actual flags
    const ownsClient = !locals.toggly;
    if (ownsClient) {
      const client = createTogglyServerClient(
        {
          ...config,
          // Request-scoped: no process signal handlers / no periodic timer unless
          // the caller opts in. close() flushes remaining usage at end of request.
          telemetryAttachProcessHandlers:
            config.telemetryAttachProcessHandlers ?? false,
          usageFlushInterval: config.usageFlushInterval ?? 0,
        },
        false,
      );
      // Pre-fetch flags before page rendering starts so Feature components
      // have cached flags available immediately
      await client.refreshFlags();
      locals.toggly = client;
    }

    try {
      return await next();
    } finally {
      if (ownsClient) {
        try {
          // Bound wait: hung usage flush must not delay the HTTP response.
          await locals.toggly?.close?.({
            timeoutMs: REQUEST_SCOPED_CLOSE_TIMEOUT_MS,
          });
        } catch {
          // Best-effort teardown; never fail the HTTP response for telemetry.
        }
      }
    }
  };
}
