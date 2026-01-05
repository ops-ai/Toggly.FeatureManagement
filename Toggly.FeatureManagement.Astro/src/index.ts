/**
 * Toggly Astro SDK - Main Entry Point
 * 
 * Feature flag management for Astro applications with support for:
 * - SSR and SSG rendering modes
 * - Client-side hydration
 * - Native Astro components
 * - React, Vue, and Svelte framework wrappers
 * - Frontmatter-based page gating
 * - Optional edge enforcement
 * 
 * This SDK includes its own embedded Toggly client implementation,
 * so no external dependencies on toggly-client-core are needed.
 */

// Integration
export { default as togglyIntegration, createTogglyMiddleware } from './integration/index.js';
export type { TogglyIntegrationOptions } from './integration/index.js';

// Server-side
export { createTogglyServerClient, TogglyServer } from './server/toggly-server.js';
export {
  getTogglyFromAstroGlobal,
  withFeatureFlag,
  anyFeatureEnabled,
  allFeaturesEnabled,
} from './server/utils.js';

// Client-side
export {
  initTogglyClient,
  refreshFlags,
  setIdentity,
  clearIdentity,
  stopRefreshInterval,
  $flags,
  $isReady,
  $error,
  $flag,
  $gate,
} from './client/store.js';

// Types
export type {
  TogglyConfig,
  Flags,
  TogglyClient,
  PageFeatureMapping,
  FeatureProps,
  FeatureClientProps,
} from './types/index.js';


