/**
 * TogglyProvider component
 * 
 * Provider component that initializes the Toggly client store.
 * While nanostores don't require a provider for state access, this component
 * ensures the store is initialized with the correct configuration.
 */

import React, { useEffect, useRef } from 'react';
import {
  disposeTogglyClient,
  getTogglyClientOwnerKey,
  initTogglyClient,
} from '../client/store.js';
import type { TogglyProviderProps } from '../types/index.js';

/**
 * TogglyProvider - Initializes Toggly client with configuration
 * 
 * This component should wrap your application root. While not strictly required
 * for hooks to work (nanostores are global), it ensures the client is properly
 * initialized with your configuration.
 * 
 * Note: In Gatsby, this is typically wrapped automatically by the plugin via
 * gatsby-ssr.js and gatsby-browser.js. Manual usage is only needed if you're
 * not using the plugin.
 * 
 * @example
 * ```tsx
 * // Manual usage (not needed if using the Gatsby plugin)
 * import { TogglyProvider } from '@ops-ai/gatsby-feature-flags-toggly';
 * 
 * function App() {
 *   return (
 *     <TogglyProvider config={{
 *       appKey: 'your-app-key',
 *       environment: 'Production'
 *     }}>
 *       <YourApp />
 *     </TogglyProvider>
 *   );
 * }
 * ```
 */
export function TogglyProvider({ config, children }: TogglyProviderProps) {
  const ownerKey = getTogglyClientOwnerKey(config);
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => {
    const ownerConfig = configRef.current;
    initTogglyClient(ownerConfig).catch((error) => {
      console.error('[TogglyProvider] Failed to initialize client:', error);
    });
    return () => disposeTogglyClient(ownerConfig);
  }, [ownerKey]);

  return <>{children}</>;
}
