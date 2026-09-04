import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { TogglyContext, TogglyContextValue } from '../src/contexts/TogglyContext';
import { useToggly } from '../src/hooks/useToggly';

// Create a mock TogglyService
const createMockService = (overrides = {}) => ({
  init: jest.fn().mockResolvedValue(undefined),
  dispose: jest.fn(),
  refresh: jest.fn().mockResolvedValue(undefined),
  isFeatureOn: jest.fn().mockResolvedValue(true),
  isFeatureOff: jest.fn().mockResolvedValue(false),
  evaluateFeatureGate: jest.fn().mockResolvedValue(true),
  on: jest.fn().mockReturnValue(() => {}),
  addStateChangeHandler: jest.fn().mockReturnValue(() => {}),
  setIdentity: jest.fn().mockResolvedValue(undefined),
  getDebugInfo: jest.fn().mockReturnValue({ version: '1.0.0', initialized: true }),
  currentIdentity: 'test-user',
  currentFeatures: { feature1: true, feature2: false },
  shouldShowFeatureDuringEvaluation: false,
  ...overrides,
});

// Wrapper component for testing hooks
const createWrapper = (contextValue: TogglyContextValue) => {
  return ({ children }: { children: React.ReactNode }) => (
    <TogglyContext.Provider value={contextValue}>
      {children}
    </TogglyContext.Provider>
  );
};

describe('useToggly', () => {
  let mockService: ReturnType<typeof createMockService>;
  let contextValue: TogglyContextValue;

  beforeEach(() => {
    mockService = createMockService();
    contextValue = {
      toggly: mockService as any,
      isReady: true,
      isLoading: false,
      error: null,
    };
  });

  it('returns isReady state from context', () => {
    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    expect(result.isReady).toBe(true);
  });

  it('returns current identity', () => {
    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    expect(result.identity).toBe('test-user');
  });

  it('returns current features', () => {
    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    expect(result.features).toEqual({ feature1: true, feature2: false });
  });

  it('provides isFeatureOn function', async () => {
    mockService.isFeatureOn.mockResolvedValue(true);

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    const isOn = await result.isFeatureOn('feature1');

    expect(mockService.isFeatureOn).toHaveBeenCalledWith('feature1', undefined, undefined);
    expect(isOn).toBe(true);
  });

  it('provides isFeatureOff function', async () => {
    mockService.isFeatureOff.mockResolvedValue(false);

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    const isOff = await result.isFeatureOff('feature1');

    expect(mockService.isFeatureOff).toHaveBeenCalledWith('feature1', undefined, undefined);
    expect(isOff).toBe(false);
  });

  it('provides refresh function that updates state', async () => {
    mockService.refresh.mockResolvedValue(undefined);
    (mockService as any).currentFeatures = { feature1: true, feature2: true };

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    expect(result.isRefreshing).toBe(false);

    await act(async () => {
      await result.refresh();
    });

    expect(mockService.refresh).toHaveBeenCalled();
    expect(result.isRefreshing).toBe(false);
  });

  it('sets isRefreshing to true during refresh', async () => {
    let resolveRefresh: () => void;
    mockService.refresh.mockImplementation(() =>
      new Promise<void>((resolve) => {
        resolveRefresh = resolve;
      })
    );

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.refresh();
    });

    // isRefreshing should be true during refresh
    await waitFor(() => {
      expect(result.isRefreshing).toBe(true);
    });

    await act(async () => {
      resolveRefresh();
      await refreshPromise;
    });

    expect(result.isRefreshing).toBe(false);
  });

  it('provides setIdentity function', async () => {
    mockService.setIdentity.mockResolvedValue(undefined);
    (mockService as any).currentIdentity = 'new-user';
    (mockService as any).currentFeatures = { feature1: false };

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    await act(async () => {
      await result.setIdentity('new-user');
    });

    expect(mockService.setIdentity).toHaveBeenCalledWith('new-user');
  });

  it('provides setIdentity function with null', async () => {
    mockService.setIdentity.mockResolvedValue(undefined);
    (mockService as any).currentIdentity = null;

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    await act(async () => {
      await result.setIdentity(null);
    });

    expect(mockService.setIdentity).toHaveBeenCalledWith(null);
  });

  it('provides getDebugInfo function', () => {
    const debugInfo = { version: '1.0.0', initialized: true };
    mockService.getDebugInfo.mockReturnValue(debugInfo);

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    const info = result.getDebugInfo();

    expect(mockService.getDebugInfo).toHaveBeenCalled();
    expect(info).toEqual(debugInfo);
  });

  it('provides on function for event subscription', () => {
    const unsubscribe = jest.fn();
    mockService.on.mockReturnValue(unsubscribe);

    const listener = jest.fn();

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    const unsub = result.on('refreshed', listener);

    expect(mockService.on).toHaveBeenCalledWith('refreshed', listener);
    expect(unsub).toBe(unsubscribe);
  });

  it('provides onFeatureChange function', () => {
    const unsubscribe = jest.fn();
    mockService.addStateChangeHandler.mockReturnValue(unsubscribe);

    const handler = jest.fn();

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    const unsub = result.onFeatureChange(handler);

    expect(mockService.addStateChangeHandler).toHaveBeenCalledWith(handler);
    expect(unsub).toBe(unsubscribe);
  });

  it('subscribes to refreshed events and updates features', async () => {
    let refreshedCallback: (event: any) => void;
    mockService.on.mockImplementation((event: string, callback: (event: any) => void) => {
      if (event === 'refreshed') {
        refreshedCallback = callback;
      }
      return () => {};
    });

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    expect(result.features).toEqual({ feature1: true, feature2: false });

    // Trigger refresh event with new features
    const newFeatures = { feature1: false, feature2: true };
    await act(async () => {
      refreshedCallback({ data: newFeatures });
    });

    await waitFor(() => {
      expect(result.features).toEqual(newFeatures);
    });
  });

  it('subscribes to identityChanged events and updates identity', async () => {
    let identityCallback: (event: any) => void;
    mockService.on.mockImplementation((event: string, callback: (event: any) => void) => {
      if (event === 'identityChanged') {
        identityCallback = callback;
      }
      return () => {};
    });

    let result: any;
    const TestComponent = () => {
      result = useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    expect(result.identity).toBe('test-user');

    // Trigger identity change event
    await act(async () => {
      identityCallback({ data: { newIdentity: 'different-user' } });
    });

    await waitFor(() => {
      expect(result.identity).toBe('different-user');
    });
  });

  it('does not subscribe to events when not ready', () => {
    const notReadyContext: TogglyContextValue = {
      ...contextValue,
      isReady: false,
    };

    const TestComponent = () => {
      useToggly();
      return null;
    };

    render(<TestComponent />, {
      wrapper: createWrapper(notReadyContext),
    });

    // Should not have subscribed to refreshed or identityChanged
    expect(mockService.on).not.toHaveBeenCalledWith('refreshed', expect.any(Function));
    expect(mockService.on).not.toHaveBeenCalledWith('identityChanged', expect.any(Function));
  });

  it('unsubscribes from events on unmount', async () => {
    const unsubscribeRefreshed = jest.fn();
    const unsubscribeIdentity = jest.fn();

    mockService.on.mockImplementation((event: string) => {
      if (event === 'refreshed') return unsubscribeRefreshed;
      if (event === 'identityChanged') return unsubscribeIdentity;
      return () => {};
    });

    const TestComponent = () => {
      useToggly();
      return null;
    };

    const { unmount } = render(<TestComponent />, {
      wrapper: createWrapper(contextValue),
    });

    unmount();

    expect(unsubscribeRefreshed).toHaveBeenCalled();
    expect(unsubscribeIdentity).toHaveBeenCalled();
  });
});
