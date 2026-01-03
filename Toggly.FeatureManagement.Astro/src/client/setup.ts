/**
 * Toggly Client Setup
 * 
 * Auto-initialization script for client-side Toggly
 */

import { initTogglyClient } from './store.js';
import type { TogglyConfig } from '../types/index.js';

/**
 * Auto-initialize Toggly if configuration is available on window
 */
if (typeof window !== 'undefined') {
  const config = (window as any).__TOGGLY_CONFIG__ as TogglyConfig | undefined;

  if (config) {
    // Initialize client with config from integration
    initTogglyClient(config).catch((error) => {
      console.error('[Toggly] Auto-initialization failed:', error);
    });
  } else {
    console.warn(
      '[Toggly] No configuration found on window.__TOGGLY_CONFIG__. ' +
        'Make sure the Toggly integration is properly configured in astro.config.mjs'
    );
  }
}

// Export for manual initialization
export { initTogglyClient };


