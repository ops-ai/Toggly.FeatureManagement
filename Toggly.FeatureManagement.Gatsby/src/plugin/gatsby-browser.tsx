/**
 * Gatsby Browser APIs
 * 
 * Client-side hooks for Toggly plugin
 */

import React from 'react';
import type { GatsbyBrowser } from 'gatsby';
import type { TogglyPluginOptions } from '../types/index.js';
import { TogglyProvider } from '../components/TogglyProvider.js';
import { initTogglyClient } from '../client/store.js';

/**
 * Initialize Toggly client on client entry
 */
export const onClientEntry: GatsbyBrowser['onClientEntry'] = (_, pluginOptions) => {
  const options = pluginOptions as unknown as TogglyPluginOptions;

  if (options.isDebug) {
    console.log('[Toggly Browser] Initializing client...');
  }

  // Initialize client store
  // Note: This is also done in TogglyProvider, but doing it here ensures
  // it happens as early as possible
  initTogglyClient(options).catch((error) => {
    console.error('[Toggly Browser] Failed to initialize client:', error);
  });
};

/**
 * Wrap root element with TogglyProvider
 * 
 * This ensures the Toggly client is initialized on the client side
 */
export const wrapRootElement: GatsbyBrowser['wrapRootElement'] = (
  { element },
  pluginOptions
) => {
  const options = pluginOptions as unknown as TogglyPluginOptions;

  return <TogglyProvider config={options}>{element}</TogglyProvider>;
};

/**
 * Optional: Handle route updates
 * 
 * You can use this to track page views or update identity based on routing
 */
// export const onRouteUpdate: GatsbyBrowser['onRouteUpdate'] = (
//   { location, prevLocation },
//   pluginOptions
// ) => {
//   const options = pluginOptions as TogglyPluginOptions;
//
//   if (options.isDebug) {
//     console.log('[Toggly Browser] Route update:', location.pathname);
//   }
//
//   // Example: Update identity based on route
//   // setIdentity(getUserIdFromLocation(location));
// };
