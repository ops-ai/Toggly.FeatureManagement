/**
 * @ops-ai/toggly-docusaurus-plugin - Docusaurus plugin and React bindings
 *
 * Provides Docusaurus plugin integration and React components/hooks
 * for gating documentation content with Toggly feature flags.
 */

import type { Plugin, LoadContext } from '@docusaurus/types';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import webpack from 'webpack';
import { fetchBuildTimeFlags } from './lib/fetch-build-flags';
import { routeToHtmlPath } from './lib/route-to-html-path';
import type { Flags } from './lib/toggly-client';

/**
 * A docs-style content directory that the plugin should scan for x-feature frontmatter.
 *
 * Mirrors @docusaurus/plugin-content-docs's `path` and `routeBasePath` options.
 * Use this when your site has multiple plugin-content-docs instances
 * (e.g. `docs/`, `sdks/`, `guides/`) — by default the plugin auto-detects them
 * from `siteConfig.plugins`, but you can override the discovery here.
 */
export interface TogglyContentRoot {
  /** Directory (relative to siteDir) containing MD/MDX files. */
  path: string;
  /** URL prefix for routes generated from this directory (no leading/trailing slash needed). */
  routeBasePath: string;
}

export interface TogglyPluginOptions {
  /** Base URI for the Toggly API (default: 'https://definitions.toggly.io') */
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
  /** 
   * Render all Feature component children during static build (SSR).
   * When true, feature-gated content renders during build so:
   * - All headings create anchors (fixing broken anchor detection)
   * - All content is indexed by search engines
   * - SEO content is present in static HTML
   * At runtime, actual flag values are still evaluated.
   * (default: true)
   */
  renderAllDuringBuild?: boolean;
  /**
   * Explicit list of docs-style content directories to scan. When omitted,
   * the plugin auto-detects content-docs plugin instances from `siteConfig.plugins`
   * and always includes the classic preset's default `{ path: 'docs', routeBasePath: 'docs' }`.
   * Set this to take full manual control of discovery.
   */
  contentRoots?: TogglyContentRoot[];
  /**
   * When true, fetch flags once at build time and bake gating into the static
   * HTML. No runtime Toggly API calls, WebSocket, or edge worker required.
   * Requires `TOGGLY_APP_KEY` (and related env) in the build environment.
   */
  staticGating?: boolean;
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
    baseURI = 'https://definitions.toggly.io',
    appKey,
    environment = 'Production',
    flagDefaults = {},
    featureFlagsRefreshInterval = 3 * 60 * 1000,
    isDebug = false,
    connectTimeout = 5 * 1000,
    identity,
    renderAllDuringBuild = true, // Default to true for better DX
    contentRoots,
    staticGating = false,
  } = options;

  // Store page feature mapping for postBuild
  let pageFeatureMapping: PageFeatureMapping = {};
  let buildTimeFlags: Flags = {};

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
          renderAllDuringBuild,
          staticGating,
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

        // Extract page feature mapping from files.
        // We parse files directly to get x-feature frontmatter and map to
        // routes using each content root's routeBasePath. Roots are either
        // supplied explicitly via `contentRoots` or auto-detected from
        // `siteConfig.plugins` (with the classic preset's `docs/` always included).
        const roots = resolveContentRoots(context, contentRoots);
        if (isDebug) {
          console.log(
            `[Toggly Plugin] Scanning content roots: ${roots
              .map(r => `${r.path} -> /${r.routeBasePath}`)
              .join(', ')}`,
          );
        }
        pageFeatureMapping = await extractFromFiles(context, roots);

        if (pluginConfig.staticGating) {
          buildTimeFlags = await fetchBuildTimeFlags({
            baseURI: pluginConfig.baseURI,
            appKey: pluginConfig.appKey,
            environment: pluginConfig.environment,
            flagDefaults: pluginConfig.flagDefaults,
            connectTimeout: pluginConfig.connectTimeout,
            isDebug: pluginConfig.isDebug,
          });
        }

        // Store data for configureWebpack and postBuild
        (this as any).__togglyPluginData = {
          pageFeatureMapping,
          buildTimeFlags,
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

      const {
        pageFeatureMapping: mapping,
        buildTimeFlags: flags,
        config: pluginConfig,
      } = pluginData;

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

      if (!pluginConfig.staticGating) {
        return;
      }

      const notFoundPath = path.join(outDir, '404.html');
      const notFoundHtml = fs.existsSync(notFoundPath)
        ? fs.readFileSync(notFoundPath, 'utf-8')
        : '<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>';

      let gatedPageCount = 0;
      for (const [route, featureKey] of Object.entries(mapping) as [string, string][]) {
        if (flags[featureKey] === true) {
          continue;
        }

        const htmlPath = routeToHtmlPath(outDir, route);
        if (!fs.existsSync(htmlPath)) {
          if (isDebug) {
            console.warn(
              `[Toggly Plugin] staticGating: no HTML for gated route ${route} (${htmlPath})`,
            );
          }
          continue;
        }

        fs.writeFileSync(htmlPath, notFoundHtml, 'utf-8');
        gatedPageCount++;
      }

      if (isDebug && gatedPageCount > 0) {
        console.log(
          `[Toggly Plugin] staticGating: replaced ${gatedPageCount} disabled page(s) with 404 HTML`,
        );
      }
    },

    /**
     * Configure Webpack: Inject Toggly config into client bundle
     */
    configureWebpack(config, isServer) {
      const pluginData = (this as any).__togglyPluginData;
      if (!pluginData) {
        return {};
      }

      const {
        pageFeatureMapping,
        buildTimeFlags: flags,
        config: pluginConfig,
      } = pluginData;

      // Static gating must define flags on both server and client bundles so
      // Docusaurus SSG emits the correct HTML during `npm run build`.
      if (pluginConfig.staticGating) {
        return {
          plugins: [
            new webpack.DefinePlugin({
              __TOGGLY_CONFIG__: JSON.stringify(pluginConfig),
              __TOGGLY_PAGE_FEATURES__: JSON.stringify(pageFeatureMapping),
              __TOGGLY_BUILD_FLAGS__: JSON.stringify(flags),
              __TOGGLY_STATIC_GATING__: JSON.stringify(true),
            }),
          ],
        };
      }

      if (isServer) {
        return {};
      }

      return {
        plugins: [
          new webpack.DefinePlugin({
            __TOGGLY_CONFIG__: JSON.stringify(pluginConfig),
            __TOGGLY_PAGE_FEATURES__: JSON.stringify(pageFeatureMapping),
            __TOGGLY_BUILD_FLAGS__: JSON.stringify({}),
            __TOGGLY_STATIC_GATING__: JSON.stringify(false),
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

      const {
        config: pluginConfig,
        pageFeatureMapping,
        buildTimeFlags: flags,
      } = pluginData;

      const headTags: { tagName: string; innerHTML: string }[] = [
        {
          tagName: 'script',
          innerHTML: `window.__TOGGLY_CONFIG__ = ${JSON.stringify(pluginConfig)};`,
        },
        {
          tagName: 'script',
          innerHTML: `window.__TOGGLY_PAGE_FEATURES__ = ${JSON.stringify(pageFeatureMapping)};`,
        },
      ];

      if (pluginConfig.staticGating) {
        headTags.push({
          tagName: 'script',
          innerHTML: `window.__TOGGLY_BUILD_FLAGS__ = ${JSON.stringify(flags)};`,
        });
      }

      return { headTags };
    },

    /**
     * Get client modules: Import the client setup module
     */
    getClientModules() {
      const pluginData = (this as any).__togglyPluginData;
      const modules = [path.resolve(__dirname, './client/setup')];

      // Runtime navbar filtering fetches flags again — skip in staticGating mode.
      if (!pluginData?.config?.staticGating) {
        modules.push(path.resolve(__dirname, './client/nav-gate'));
      }

      return modules;
    },
  };
}


/**
 * Resolve the set of content roots the plugin should scan.
 *
 * Strategy:
 * 1. If `contentRootsOverride` is provided, use it verbatim (caller knows best).
 * 2. Otherwise, auto-detect by scanning `siteConfig.plugins` for
 *    `@docusaurus/plugin-content-docs` instances and reading each one's
 *    `path`/`routeBasePath` options. The classic preset's default
 *    `{ path: 'docs', routeBasePath: 'docs' }` is always included so existing
 *    sites keep working without configuration.
 *
 * Exported for testing.
 */
export function resolveContentRoots(
  context: LoadContext,
  contentRootsOverride?: TogglyContentRoot[],
): TogglyContentRoot[] {
  if (contentRootsOverride && contentRootsOverride.length > 0) {
    return contentRootsOverride.map(normalizeContentRoot);
  }

  const discovered = discoverContentRootsFromConfig(context);
  const roots = new Map<string, TogglyContentRoot>();

  // Always include the classic preset's docs root.
  const fallback = normalizeContentRoot({ path: 'docs', routeBasePath: 'docs' });
  roots.set(rootKey(fallback), fallback);

  for (const root of discovered) {
    const normalized = normalizeContentRoot(root);
    roots.set(rootKey(normalized), normalized);
  }

  return Array.from(roots.values());
}

function normalizeContentRoot(root: TogglyContentRoot): TogglyContentRoot {
  const trimmedPath = root.path.replace(/^[/\\]+|[/\\]+$/g, '');
  const trimmedRouteBasePath = root.routeBasePath.replace(/^\/+|\/+$/g, '');
  return {
    path: trimmedPath,
    routeBasePath: trimmedRouteBasePath,
  };
}

function rootKey(root: TogglyContentRoot): string {
  return `${root.path}|${root.routeBasePath}`;
}

const CONTENT_DOCS_PLUGIN_NAMES = new Set([
  '@docusaurus/plugin-content-docs',
  'plugin-content-docs',
]);

/**
 * Inspect `siteConfig.plugins` for plugin-content-docs instances and return
 * their { path, routeBasePath } pairs. Plugin entries can be:
 *  - 'plugin-id'                                → no options
 *  - ['plugin-id', { path, routeBasePath }]    → options inline
 *  - a function/object plugin                   → not introspectable, skip
 *
 * If a plugin omits `path` or `routeBasePath`, those default to 'docs'
 * (matching @docusaurus/plugin-content-docs's own defaults).
 *
 * Exported for testing.
 */
export function discoverContentRootsFromConfig(context: LoadContext): TogglyContentRoot[] {
  const result: TogglyContentRoot[] = [];
  const plugins = (context.siteConfig?.plugins ?? []) as unknown[];

  for (const entry of plugins) {
    if (!Array.isArray(entry) || entry.length === 0) {
      continue;
    }

    const [name, opts] = entry as [unknown, unknown];
    if (typeof name !== 'string') continue;
    if (!CONTENT_DOCS_PLUGIN_NAMES.has(name)) continue;

    const options = (opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {});
    const pathValue = typeof options.path === 'string' ? options.path : 'docs';
    const routeBasePathValue =
      typeof options.routeBasePath === 'string' ? options.routeBasePath : 'docs';

    result.push({ path: pathValue, routeBasePath: routeBasePathValue });
  }

  return result;
}

/**
 * Extract page feature mapping by parsing MD/MDX files in the given content roots.
 * Maps file paths to Docusaurus route paths using each root's `routeBasePath`.
 */
async function extractFromFiles(
  context: LoadContext,
  roots: TogglyContentRoot[],
): Promise<PageFeatureMapping> {
  const pageFeatureMapping: PageFeatureMapping = {};

  for (const root of roots) {
    const rootMappings = await extractFromRoot(context, root);
    Object.assign(pageFeatureMapping, rootMappings);
  }

  return pageFeatureMapping;
}

async function extractFromRoot(
  context: LoadContext,
  root: TogglyContentRoot,
): Promise<PageFeatureMapping> {
  const { siteDir, baseUrl } = context;
  const rootDir = path.isAbsolute(root.path)
    ? root.path
    : path.join(siteDir, root.path);
  const pageFeatureMapping: PageFeatureMapping = {};

  if (!fs.existsSync(rootDir)) {
    return pageFeatureMapping;
  }

  const files = await glob('**/*.{md,mdx}', {
    cwd: rootDir,
    absolute: false,
    ignore: ['node_modules/**'],
  });

  const stripOrderPrefix = (seg: string): string => seg.replace(/^\d+-/, '');
  const normalizedRouteBase = root.routeBasePath; // already trimmed of slashes

  for (const file of files) {
    const filePath = path.join(rootDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!frontmatterMatch) continue;

    const xFeatureMatch = frontmatterMatch[1].match(/^x-feature:\s*(.+)$/m);
    if (!xFeatureMatch) continue;

    const featureKey = xFeatureMatch[1].trim().replace(/^["']|["']$/g, '');

    const normalized = file
      .replace(/\\/g, '/')
      .split('/')
      .map(stripOrderPrefix)
      .join('/');

    let relativeRoute = normalized.replace(/\.(md|mdx)$/, '');

    // Index files become the parent directory route
    if (path.basename(relativeRoute) === 'index') {
      relativeRoute = path.dirname(relativeRoute);
      if (relativeRoute === '.') {
        relativeRoute = '';
      }
    }

    relativeRoute = relativeRoute.replace(/^\/+/, '');

    let routePath: string;
    if (normalizedRouteBase === '') {
      // Root-level routes (routeBasePath: '/') — file paths map directly under '/'.
      routePath = relativeRoute === '' ? '/' : `/${relativeRoute}`;
    } else if (relativeRoute === '') {
      routePath = `/${normalizedRouteBase}`;
    } else {
      routePath = `/${normalizedRouteBase}/${relativeRoute}`;
    }

    routePath = routePath.replace(/\/+$/, '') || '/';

    // Prepend baseUrl when the site is served from a subpath (e.g. GitHub Pages).
    let fullRoutePath = routePath;
    if (baseUrl && baseUrl !== '/') {
      const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
      fullRoutePath = routePath === '/' ? normalizedBaseUrl || '/' : normalizedBaseUrl + routePath;
    }

    pageFeatureMapping[fullRoutePath] = featureKey;
  }

  return pageFeatureMapping;
}

// Export React components and hooks
export { TogglyProvider, useToggly, useFlag, Feature, isStaticGatingMode, readBuildFlagsSnapshot } from './client';
export type {
  TogglyProviderProps,
  TogglyContextValue,
  FeatureProps,
} from './client';
