/**
 * Example Middleware Configuration for Toggly in Astro
 * 
 * Copy this to src/middleware.ts in your Astro project
 */

import { sequence } from 'astro:middleware';
import { createTogglyMiddleware } from '@ops-ai/astro-feature-flags-toggly';

// Create Toggly middleware with your configuration
const toggly = createTogglyMiddleware({
  appKey: import.meta.env.TOGGLY_APP_KEY,
  environment: import.meta.env.TOGGLY_ENVIRONMENT || 'Production',
  baseURI: 'https://client.toggly.io',
  flagDefaults: {
    // Add your default flag values here
    'example-feature': false,
  },
  isDebug: import.meta.env.DEV, // Enable debug in development
});

// You can add other middleware here and sequence them
export const onRequest = sequence(toggly);

/**
 * For more advanced use cases, you can also access the Toggly client directly:
 * 
 * export const onRequest = sequence(
 *   toggly,
 *   async (context, next) => {
 *     // Access Toggly client
 *     const isEnabled = await context.locals.toggly.getFlag('my-feature');
 *     
 *     if (isEnabled) {
 *       // Do something when feature is enabled
 *     }
 *     
 *     return next();
 *   }
 * );
 */


