import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { TogglyContext, TogglyContextValue } from '../src/contexts/TogglyContext';
import { Feature, withFeature } from '../src/components/Feature';

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
  getDebugInfo: jest.fn().mockReturnValue({ version: '1.0.0' }),
  currentIdentity: 'test-user',
  currentFeatures: { feature1: true },
  shouldShowFeatureDuringEvaluation: false,
  ...overrides,
});

// Wrapper component for testing
const createWrapper = (contextValue: TogglyContextValue) => {
  return ({ children }: { children: React.ReactNode }) => (
    <TogglyContext.Provider value={contextValue}>
      {children}
    </TogglyContext.Provider>
  );
};

describe('Feature', () => {
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

  it('renders children when feature is enabled', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    const { getByText } = render(
      <Feature featureKey="enabledFeature">
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(getByText('Feature Content')).toBeTruthy();
    });
  });

  it('renders fallback when feature is disabled', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(false);

    const { getByText, queryByText } = render(
      <Feature featureKey="disabledFeature" fallback={<div>Fallback</div>}>
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(getByText('Fallback')).toBeTruthy();
      expect(queryByText('Feature Content')).toBeNull();
    });
  });

  it('renders nothing when feature is disabled and no fallback', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(false);

    const { queryByText } = render(
      <Feature featureKey="disabledFeature">
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(queryByText('Feature Content')).toBeNull();
    });
  });

  it('renders loading component while evaluating', async () => {
    // Make evaluation take a long time
    mockService.evaluateFeatureGate.mockImplementation(() => new Promise(() => {}));

    const { getByText, queryByText } = render(
      <Feature featureKey="testFeature" loading={<div>Loading...</div>}>
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    expect(getByText('Loading...')).toBeTruthy();
    expect(queryByText('Feature Content')).toBeNull();
  });

  it('shows feature during evaluation when shouldShowFeatureDuringEvaluation is true', async () => {
    mockService.evaluateFeatureGate.mockImplementation(() => new Promise(() => {}));
    mockService.shouldShowFeatureDuringEvaluation = true;

    const { getByText } = render(
      <Feature featureKey="testFeature">
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    expect(getByText('Feature Content')).toBeTruthy();
  });

  it('evaluates with correct parameters for single feature', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    render(
      <Feature featureKey="singleFeature">
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.evaluateFeatureGate).toHaveBeenCalledWith(
        ['singleFeature'],
        'all',
        false
      );
    });
  });

  it('evaluates with correct parameters for multiple features', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    render(
      <Feature featureKeys={['feature1', 'feature2']} requirement="any">
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.evaluateFeatureGate).toHaveBeenCalledWith(
        ['feature1', 'feature2'],
        'any',
        false
      );
    });
  });

  it('combines featureKey and featureKeys', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    render(
      <Feature featureKey="feature0" featureKeys={['feature1', 'feature2']}>
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.evaluateFeatureGate).toHaveBeenCalledWith(
        ['feature0', 'feature1', 'feature2'],
        'all',
        false
      );
    });
  });

  it('supports negate option', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    render(
      <Feature featureKey="testFeature" negate>
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.evaluateFeatureGate).toHaveBeenCalledWith(
        ['testFeature'],
        'all',
        true
      );
    });
  });

  it('renders children when no features specified', async () => {
    const { getByText } = render(
      <Feature featureKeys={[]}>
        <div>Always Visible</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(getByText('Always Visible')).toBeTruthy();
    });

    expect(mockService.evaluateFeatureGate).not.toHaveBeenCalled();
  });

  it('handles evaluation error by hiding content', async () => {
    mockService.evaluateFeatureGate.mockRejectedValue(new Error('Evaluation failed'));

    const { queryByText } = render(
      <Feature featureKey="errorFeature">
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(queryByText('Feature Content')).toBeNull();
    });
  });

  it('subscribes to effective flags changed events', async () => {
    let refreshCallback: () => void;
    mockService.on.mockImplementation((event: string, callback: () => void) => {
      if (event === 'effectiveFlagsChanged') {
        refreshCallback = callback;
      }
      return () => {};
    });

    mockService.evaluateFeatureGate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const { queryByText, getByText } = render(
      <Feature featureKey="testFeature">
        <div>Feature Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(queryByText('Feature Content')).toBeNull();
    });

    // Trigger effective flag change
    await act(async () => {
      refreshCallback();
    });

    await waitFor(() => {
      expect(getByText('Feature Content')).toBeTruthy();
    });
  });

  it('unsubscribes on unmount', async () => {
    const unsubscribe = jest.fn();
    mockService.on.mockReturnValue(unsubscribe);
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    const { unmount } = render(
      <Feature featureKey="testFeature">
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.on).toHaveBeenCalled();
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not evaluate when not ready', () => {
    const notReadyContext: TogglyContextValue = {
      ...contextValue,
      isReady: false,
    };

    render(
      <Feature featureKey="testFeature">
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(notReadyContext) }
    );

    expect(mockService.evaluateFeatureGate).not.toHaveBeenCalled();
  });

  it('does not subscribe to events when not ready', () => {
    const notReadyContext: TogglyContextValue = {
      ...contextValue,
      isReady: false,
    };

    render(
      <Feature featureKey="testFeature">
        <div>Content</div>
      </Feature>,
      { wrapper: createWrapper(notReadyContext) }
    );

    expect(mockService.on).not.toHaveBeenCalledWith('refreshed', expect.any(Function));
  });
});

describe('withFeature', () => {
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

  it('wraps component with feature check', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    const TestComponent = ({ message }: { message: string }) => (
      <div>{message}</div>
    );

    const WrappedComponent = withFeature(TestComponent, {
      featureKey: 'testFeature',
    });

    const { getByText } = render(
      <WrappedComponent message="Hello World" />,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(getByText('Hello World')).toBeTruthy();
    });
  });

  it('shows fallback when feature is disabled', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(false);

    const TestComponent = ({ message }: { message: string }) => (
      <div>{message}</div>
    );

    const WrappedComponent = withFeature(TestComponent, {
      featureKey: 'testFeature',
      fallback: <div>Feature Disabled</div>,
    });

    const { getByText, queryByText } = render(
      <WrappedComponent message="Hello World" />,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(getByText('Feature Disabled')).toBeTruthy();
      expect(queryByText('Hello World')).toBeNull();
    });
  });

  it('passes all props to wrapped component', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    const TestComponent = ({ name, age }: { name: string; age: number }) => (
      <div>{`${name} is ${age} years old`}</div>
    );

    const WrappedComponent = withFeature(TestComponent, {
      featureKey: 'testFeature',
    });

    const { getByText } = render(
      <WrappedComponent name="Alice" age={30} />,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(getByText('Alice is 30 years old')).toBeTruthy();
    });
  });

  it('supports multiple feature keys', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(true);

    const TestComponent = () => <div>Content</div>;

    const WrappedComponent = withFeature(TestComponent, {
      featureKeys: ['feature1', 'feature2'],
      requirement: 'any',
    });

    render(
      <WrappedComponent />,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.evaluateFeatureGate).toHaveBeenCalledWith(
        ['feature1', 'feature2'],
        'any',
        false
      );
    });
  });

  it('supports negate option', async () => {
    mockService.evaluateFeatureGate.mockResolvedValue(false);

    const TestComponent = () => <div>Content</div>;

    const WrappedComponent = withFeature(TestComponent, {
      featureKey: 'maintenance',
      negate: true,
    });

    render(
      <WrappedComponent />,
      { wrapper: createWrapper(contextValue) }
    );

    await waitFor(() => {
      expect(mockService.evaluateFeatureGate).toHaveBeenCalledWith(
        ['maintenance'],
        'all',
        true
      );
    });
  });
});
