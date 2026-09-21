import React, {
  useState,
  useEffect,
  useRef,
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
export function TogglyProvider(props: TogglyProviderProps): React.ReactElement {
  // A new app/environment/collector is a different owner, including all child hook state.
  const ownerKey = JSON.stringify([props.appKey, props.environment, props.baseURI,
    props.enableTelemetry, props.metricsBaseUrl, props.telemetryFlushIntervalMs]);
  return <TogglyProviderOwner key={ownerKey} {...props} />;
}

function TogglyProviderOwner({
  children, onReady, onError, loadingComponent, waitForInit = true, ...config
}: TogglyProviderProps): React.ReactElement {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [_featuresRevision, setFeaturesRevision] = useState(0);
  const togglyRef = useRef<TogglyService | null>(null);
  const initialConfig = useRef(config);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };

  useEffect(() => {
    let retired = false;
    const settings = initialConfig.current;
    const service = new TogglyService({
      ...settings,
      onError: error => callbacks.current.onError?.(error),
      appState: createAppStateProvider(),
      networkInfo: settings.networkInfo ?? tryCreateNetInfoProvider(),
    });
    togglyRef.current = service;
    setIsReady(false);
    setIsLoading(true);
    setError(null);
    // Publish the owner for waitForInit=false without waiting for network/storage.
    setFeaturesRevision(revision => revision + 1);
    service.on('effectiveFlagsChanged', () => {
      if (!retired) setFeaturesRevision(revision => revision + 1);
    });
    service.on('error', event => {
      if (!retired) {
        const payload = event.data as { error?: unknown } | undefined;
        setError(new Error(String(payload?.error ?? 'Toggly error')));
      }
    });
    void service.init().then(() => {
      if (retired) return;
      setIsReady(true);
      setIsLoading(false);
      callbacks.current.onReady?.();
    }).catch(err => {
      if (retired) return;
      const failure = err instanceof Error ? err : new Error('Initialization failed');
      setError(failure);
      setIsLoading(false);
      callbacks.current.onError?.(failure);
    });
    return () => {
      retired = true;
      service.dispose();
      if (togglyRef.current === service) togglyRef.current = null;
    };
  }, []);

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

  try {
    await service.init();
  } catch (error) {
    service.dispose();
    throw error;
  }

  // A configured factory shares one explicit owner across its mounted providers.
  // Once its last mount retires, a later mount gets a fresh owner and reporter.
  let prepared: TogglyService | null = service;
  let mounts = 0;
  let preparedReady = true;
  return function PreInitializedTogglyProvider({ children }: { children: ReactNode }) {
    const [value, setValue] = useState<TogglyContextValue | null>(() => prepared ? {
      toggly: prepared, isReady: preparedReady, isLoading: !preparedReady, error: null,
    } : null);
    useEffect(() => {
      let retired = false;
      const alreadyReady = prepared !== null && preparedReady;
      const owner = prepared ?? new TogglyService({
        ...config, appState: createAppStateProvider(),
        networkInfo: config.networkInfo ?? tryCreateNetInfoProvider(),
      });
      prepared = owner;
      preparedReady = alreadyReady;
      mounts++;
      const publish = (isReady: boolean, error: Error | null = null) => {
        if (!retired) setValue({ toggly: owner, isReady, isLoading: !isReady && !error, error });
      };
      const unsubscribe = owner.on('effectiveFlagsChanged', () => publish(owner.initialized));
      publish(alreadyReady);
      if (!alreadyReady) void owner.init().then(() => {
        if (prepared === owner) preparedReady = true;
        publish(true);
      }).catch(error => {
        publish(false, error instanceof Error ? error : new Error('Initialization failed'));
      });
      return () => {
        retired = true;
        unsubscribe();
        mounts--;
        if (mounts === 0) {
          owner.dispose();
          if (prepared === owner) { prepared = null; preparedReady = false; }
        }
      };
    }, []);
    if (!value?.isReady) return <></>;
    return <TogglyContext.Provider value={value}>{children}</TogglyContext.Provider>;
  };
}
