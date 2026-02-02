/**
 * useToggly hook
 * 
 * Hook to access the full Toggly store and utilities
 */

import { useStore } from '@nanostores/react';
import {
  $flags,
  $isReady,
  $error,
  refreshFlags as storeRefreshFlags,
  setIdentity as storeSetIdentity,
  clearIdentity as storeClearIdentity,
} from '../client/store.js';
import type { UseTogglyResult } from '../types/index.js';

/**
 * Hook to access the full Toggly store
 * 
 * Provides access to all flags, ready state, error state, and utility functions.
 * 
 * @returns Object with flags, ready state, error, and utility functions
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { flags, isReady, error, refreshFlags } = useToggly();
 *   
 *   const handleRefresh = async () => {
 *     await refreshFlags();
 *   };
 *   
 *   if (!isReady) return <Loading />;
 *   if (error) return <ErrorMessage error={error} />;
 *   
 *   return (
 *     <div>
 *       <button onClick={handleRefresh}>Refresh Flags</button>
 *       <pre>{JSON.stringify(flags, null, 2)}</pre>
 *     </div>
 *   );
 * }
 * ```
 */
export function useToggly(): UseTogglyResult & {
  setIdentity: (identity: string) => void;
  clearIdentity: () => void;
} {
  const flags = useStore($flags);
  const isReady = useStore($isReady);
  const error = useStore($error);

  return {
    flags,
    isReady,
    error,
    refreshFlags: storeRefreshFlags,
    setIdentity: storeSetIdentity,
    clearIdentity: storeClearIdentity,
  };
}
