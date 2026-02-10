import React, { createContext, useContext } from 'react';
import type { TogglyService } from '@ops-ai/react-native-toggly-core';

/**
 * Toggly context value
 */
export interface TogglyContextValue {
  /**
   * The Toggly service instance
   */
  toggly: TogglyService;

  /**
   * Whether the SDK is initialized and ready
   */
  isReady: boolean;

  /**
   * Whether features are currently loading
   */
  isLoading: boolean;

  /**
   * Error if initialization failed
   */
  error: Error | null;
}

/**
 * Toggly React Context
 */
export const TogglyContext = createContext<TogglyContextValue | null>(null);

/**
 * Hook to access the Toggly context
 * @throws Error if used outside of TogglyProvider
 */
export function useTogglyContext(): TogglyContextValue {
  const context = useContext(TogglyContext);

  if (!context) {
    throw new Error(
      'useTogglyContext must be used within a TogglyProvider. ' +
        'Make sure you have wrapped your app with <TogglyProvider>.'
    );
  }

  return context;
}

/**
 * Hook to access the Toggly service directly
 */
export function useTogglyService(): TogglyService {
  const { toggly } = useTogglyContext();
  return toggly;
}
