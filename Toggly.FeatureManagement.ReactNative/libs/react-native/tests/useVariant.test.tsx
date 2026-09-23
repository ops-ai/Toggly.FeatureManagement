import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { TogglyContext, TogglyContextValue } from '../src/contexts/TogglyContext';
import { useVariant } from '../src/hooks/useVariant';

const createMockService = (overrides = {}) => ({
  getVariant: jest.fn().mockReturnValue(null),
  on: jest.fn().mockReturnValue(() => {}),
  ...overrides,
});

const createWrapper = (contextValue: TogglyContextValue) => {
  return ({ children }: { children: React.ReactNode }) => (
    <TogglyContext.Provider value={contextValue}>
      {children}
    </TogglyContext.Provider>
  );
};

describe('useVariant', () => {
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

  it('returns the initial variant snapshot from the service', () => {
    const variant = { name: 'treatment', configurationValue: { color: 'blue' } };
    mockService.getVariant.mockReturnValue(variant);

    let result: ReturnType<typeof useVariant>;
    const TestComponent = () => {
      result = useVariant('feature1');
      return null;
    };

    render(<TestComponent />, { wrapper: createWrapper(contextValue) });

    expect(result!).toEqual(variant);
    expect(mockService.getVariant).toHaveBeenCalledWith('feature1');
  });

  it('returns null when the service has no variant assignment', () => {
    let result: ReturnType<typeof useVariant>;
    const TestComponent = () => {
      result = useVariant('feature1');
      return null;
    };

    render(<TestComponent />, { wrapper: createWrapper(contextValue) });

    expect(result!).toBeNull();
  });

  it('re-renders when effectiveFlagsChanged fires', async () => {
    let refreshedCallback: (() => void) | undefined;
    let localGatesCallback: (() => void) | undefined;
    mockService.on.mockImplementation((event: string, callback: () => void) => {
      if (event === 'effectiveFlagsChanged') refreshedCallback = callback;
      if (event === 'localGatesChanged') localGatesCallback = callback;
      return () => {};
    });

    let result: ReturnType<typeof useVariant>;
    const TestComponent = () => {
      result = useVariant('feature1');
      return null;
    };

    render(<TestComponent />, { wrapper: createWrapper(contextValue) });
    expect(result!).toBeNull();

    const nextVariant = { name: 'treatment', configurationValue: 42 };
    mockService.getVariant.mockReturnValue(nextVariant);
    await act(async () => {
      refreshedCallback?.();
    });

    await waitFor(() => {
      expect(result!).toEqual(nextVariant);
    });

    expect(localGatesCallback).toBeDefined();
  });

  it('does not subscribe to events when not ready', () => {
    const notReadyContext: TogglyContextValue = { ...contextValue, isReady: false };

    const TestComponent = () => {
      useVariant('feature1');
      return null;
    };

    render(<TestComponent />, { wrapper: createWrapper(notReadyContext) });

    expect(mockService.on).not.toHaveBeenCalled();
  });

  it('unsubscribes from events on unmount', () => {
    const unsubscribeRefresh = jest.fn();
    const unsubscribeLocalGates = jest.fn();
    mockService.on.mockImplementation((event: string) => {
      if (event === 'effectiveFlagsChanged') return unsubscribeRefresh;
      if (event === 'localGatesChanged') return unsubscribeLocalGates;
      return () => {};
    });

    const TestComponent = () => {
      useVariant('feature1');
      return null;
    };

    const { unmount } = render(<TestComponent />, { wrapper: createWrapper(contextValue) });
    unmount();

    expect(unsubscribeRefresh).toHaveBeenCalled();
    expect(unsubscribeLocalGates).toHaveBeenCalled();
  });
});
