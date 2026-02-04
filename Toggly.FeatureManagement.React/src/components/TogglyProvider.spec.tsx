import React, { useContext } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import createTogglyProvider from './TogglyProvider';
import { context } from '../contexts/toggly.context';

// Mock fetch for API-based tests
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('createTogglyProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return a Provider component', async () => {
    const TogglyProvider = await createTogglyProvider({
      featureDefaults: { F1: true },
    });

    expect(TogglyProvider).toBeDefined();
    expect(typeof TogglyProvider).toBe('function');
  });

  it('should render children', async () => {
    const TogglyProvider = await createTogglyProvider({
      featureDefaults: { F1: true },
    });

    render(
      <TogglyProvider>
        <span data-testid="child">Hello</span>
      </TogglyProvider>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('should provide Toggly service via context', async () => {
    const TogglyProvider = await createTogglyProvider({
      featureDefaults: { F1: true },
    });

    // Component that reads context
    function ContextReader() {
      const ctx = useContext(context);
      return (
        <span data-testid="ctx">
          {ctx.toggly ? 'has-service' : 'no-service'}
        </span>
      );
    }

    render(
      <TogglyProvider>
        <ContextReader />
      </TogglyProvider>
    );

    expect(screen.getByTestId('ctx')).toHaveTextContent('has-service');
  });

  it('should create Toggly with given config', async () => {
    const TogglyProvider = await createTogglyProvider({
      featureDefaults: { TestFlag: true },
    });

    function FlagChecker() {
      const ctx = useContext(context);
      const [result, setResult] = React.useState<boolean | null>(null);

      React.useEffect(() => {
        if (ctx.toggly) {
          ctx.toggly.isFeatureOn('TestFlag').then(setResult);
        }
      }, [ctx.toggly]);

      return <span data-testid="flag">{result === null ? 'loading' : String(result)}</span>;
    }

    render(
      <TogglyProvider>
        <FlagChecker />
      </TogglyProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flag')).toHaveTextContent('true');
    });
  });

  it('should create Toggly with showFeatureDuringEvaluation', async () => {
    const TogglyProvider = await createTogglyProvider({
      featureDefaults: { F1: true },
      showFeatureDuringEvaluation: true,
    });

    function EvalChecker() {
      const ctx = useContext(context);
      return (
        <span data-testid="eval">
          {ctx.toggly?.shouldShowFeatureDuringEvaluation ? 'true' : 'false'}
        </span>
      );
    }

    render(
      <TogglyProvider>
        <EvalChecker />
      </TogglyProvider>
    );

    expect(screen.getByTestId('eval')).toHaveTextContent('true');
  });

  it('should work with API-based config', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ApiFlag: true }),
    });

    const TogglyProvider = await createTogglyProvider({
      appKey: 'test-key',
      environment: 'Production',
    });

    function ApiChecker() {
      const ctx = useContext(context);
      const [result, setResult] = React.useState<boolean | null>(null);

      React.useEffect(() => {
        if (ctx.toggly) {
          ctx.toggly.isFeatureOn('ApiFlag').then(setResult);
        }
      }, [ctx.toggly]);

      return <span data-testid="api">{result === null ? 'loading' : String(result)}</span>;
    }

    render(
      <TogglyProvider>
        <ApiChecker />
      </TogglyProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('api')).toHaveTextContent('true');
    });
  });
});
