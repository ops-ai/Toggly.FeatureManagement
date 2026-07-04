import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import {
  TogglyService,
  TogglyConfig,
  AppStateProvider,
  AppStateType,
  NetworkInfoProvider,
  NetworkState,
} from '@ops-ai/react-native-toggly-core';
import { TogglyContext, TogglyContextValue } from '../contexts/TogglyContext';

/**
 * Props for TogglyProvider component
 */
export interface TogglyProviderProps extends TogglyConfig {
  /**
   * Child components
   */
  children: ReactNode;

  /**
   * Callback when initialization completes
   */
  onReady?: () => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void;

  /**
   * Custom loading component to show while initializing
   */
  loadingComponent?: ReactNode;

  /**
   * Whether to wait for initialization before rendering children
   * @default true
   */
  waitForInit?: boolean;
}

/**
 * Create an app state provider that wraps React Native's AppState
 */
function createAppStateProvider(): AppStateProvider {
  const mapAppState = (state: AppStateStatus): AppStateType => {
    switch (state) {
      case 'active':
        return 'active';
      case 'background':
        return 'background';
      case 'inactive':
        return 'inactive';
      case 'extension':
        return 'extension';
      default:
        return 'unknown';
    }
  };

  return {
    getCurrentState: () => mapAppState(AppState.currentState),
    subscribe: (listener) => {
      const subscription = AppState.addEventListener('change', (state) => {
        listener(mapAppState(state));
      });
      return () => subscription.remove();
    },
  };
}

/**
 * Try to create a network info provider using @react-native-community/netinfo
 */
function tryCreateNetInfoProvider(): NetworkInfoProvider | undefined {
  try {
    // Dynamic import to make netinfo optional
    const NetInfo = require('@react-native-community/netinfo').default;

    return {
      getState: async (): Promise<NetworkState> => {
        const state = await NetInfo.fetch();
        return {
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
        };
      },
      subscribe: (listener) => {
        const unsubscribe = NetInfo.addEventListener((state: any) => {
          listener({
            isConnected: state.isConnected,
            isInternetReachable: state.isInternetReachable,
          });
        });
        return unsubscribe;
      },
    };
  } catch {
    // NetInfo not installed, return undefined
    return undefined;
  }
}

/**
 * TogglyProvider component that initializes and provides Toggly context
 *
 * @example
 * ```tsx
 * // With Toggly.io
 * <TogglyProvider
 *   appKey="your-app-key"
 *   environment="Production"
 *   identity={user?.id}
 * >
 *   <App />
 * </TogglyProvider>
 *
 * // Without Toggly.io (feature defaults only)
 * <TogglyProvider
 *   featureDefaults={{
 *     newFeature: true,
 *     betaFeature: false,
 *   }}
 * >
 *   <App />
 * </TogglyProvider>
 * ```
 */
export function TogglyProvider({
  children,
  onReady,
  onError,
  loadingComponent,
  waitForInit = true,
  ...config
}: TogglyProviderProps): React.ReactElement {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [_featuresRevision, setFeaturesRevision] = useState(0);
  const togglyRef = useRef<TogglyService | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize Toggly service
  const initToggly = useCallback(async () => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    try {
      // Create providers
      const appStateProvider = createAppStateProvider();
      const networkInfoProvider = config.networkInfo ?? tryCreateNetInfoProvider();

      // Create service with providers
      const service = new TogglyService({
        ...config,
        onError,
        appState: appStateProvider,
        networkInfo: networkInfoProvider,
      });

      togglyRef.current = service;
      service.on('effectiveFlagsChanged', () => {
        setFeaturesRevision((revision) => revision + 1);
      });
      service.on('error', (event) => {
        const payload = event.data as { error?: unknown } | undefined;
        setError(new Error(String(payload?.error ?? 'Toggly error')));
      });

      // Initialize
      await service.init();

      setIsReady(true);
      setIsLoading(false);
      onReady?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Initialization failed');
      setError(error);
      setIsLoading(false);
      onError?.(error);
    }
  }, [config, onReady, onError]);

  useEffect(() => {
    initToggly();

    return () => {
      togglyRef.current?.dispose();
    };
  }, [initToggly]);

  // Handle identity changes from props
  useEffect(() => {
    if (isReady && togglyRef.current && config.identity !== undefined) {
      const currentIdentity = togglyRef.current.currentIdentity;
      if (config.identity !== currentIdentity) {
        togglyRef.current.setIdentity(config.identity ?? null);
      }
    }
  }, [config.identity, isReady]);

  // Create context value
  const contextValue: TogglyContextValue | null = togglyRef.current
    ? {
        toggly: togglyRef.current,
        isReady,
        isLoading,
        error,
      }
    : null;

  // Show loading state if configured and not ready
  if (waitForInit && isLoading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    return <></>;
  }

  // Don't render if context not ready
  if (!contextValue) {
    return <></>;
  }

  return (
    <TogglyContext.Provider value={contextValue}>
      {children}
    </TogglyContext.Provider>
  );
}

/**
 * Create a pre-configured Toggly provider
 * Useful when you need to await initialization before rendering
 *
 * @example
 * ```tsx
 * const TogglyProvider = await createTogglyProvider({
 *   appKey: 'your-app-key',
 *   environment: 'Production',
 * });
 *
 * // Later in your app
 * <TogglyProvider>
 *   <App />
 * </TogglyProvider>
 * ```
 */
export async function createTogglyProvider(
  config: TogglyConfig
): Promise<React.FC<{ children: ReactNode }>> {
  // Create providers
  const appStateProvider = createAppStateProvider();
  const networkInfoProvider = config.networkInfo ?? tryCreateNetInfoProvider();

  // Create and initialize service
  const service = new TogglyService({
    ...config,
    appState: appStateProvider,
    networkInfo: networkInfoProvider,
  });

  await service.init();

  // Return a pre-initialized provider component
  return function PreInitializedTogglyProvider({
    children,
  }: {
    children: ReactNode;
  }) {
    const contextValue: TogglyContextValue = {
      toggly: service,
      isReady: true,
      isLoading: false,
      error: null,
    };

    return (
      <TogglyContext.Provider value={contextValue}>
        {children}
      </TogglyContext.Provider>
    );
  };
}
