/**
 * Example Astro Configuration with Toggly Integration
 * 
 * Copy relevant parts to your astro.config.mjs
 */

import { defineConfig } from 'astro/config';
import togglyIntegration from '@ops-ai/astro-feature-flags-toggly/integration';

// Optional: Import adapter for SSR
// import node from '@astrojs/node';

export default defineConfig({
  // Optional: Configure output mode
  // output: 'server', // For SSR
  // output: 'static', // For SSG (default)
  
  // Optional: Configure adapter for SSR
  // adapter: node({
  //   mode: 'standalone'
  // }),

  integrations: [
    // Toggly Integration
    togglyIntegration({
      // Required: Your Toggly app key
      appKey: process.env.TOGGLY_APP_KEY,
      
      // Optional: Environment name (default: 'Production')
      environment: process.env.TOGGLY_ENVIRONMENT || 'Production',
      
      // Optional: API base URI (default: 'https://client.toggly.io')
      baseURI: 'https://client.toggly.io',
      
      // Optional: Default flag values when API is unavailable
      flagDefaults: {
        'example-feature': false,
        'beta-feature': false,
      },
      
      // Optional: Refresh interval in milliseconds (default: 180000 = 3 minutes)
      featureFlagsRefreshInterval: 3 * 60 * 1000,
      
      // Optional: Enable debug logging (default: false)
      isDebug: process.env.NODE_ENV === 'development',
      
      // Optional: Connection timeout in milliseconds (default: 5000)
      connectTimeout: 5000,
      
      // Optional: User identity for targeting
      // identity: getUserId(),
    }),
  ],
});


