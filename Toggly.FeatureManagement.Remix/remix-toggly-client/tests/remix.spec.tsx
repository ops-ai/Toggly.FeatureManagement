/**
 * Tests for Remix-specific utilities
 */

import React from 'react';
import { render, screen, renderHook } from '@testing-library/react';
import {
  extractServerContext,
  hasTogglyContext,
  TogglyScript,
  getWindowTogglyData,
  RemixTogglyProvider,
  useTogglyLoaderData,
  useTogglyRouteLoaderData,
} from '../src/remix';
import { TOGGLY_LOADER_KEY, type ServerFeatureContext } from '@ops-ai/remix-toggly-core';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';

// Mock @remix-run/react
jest.mock('@remix-run/react', () => ({
  useLoaderData: jest.fn(),
  useRouteLoaderData: jest.fn(),
}));

const mockUseLoaderData = useLoaderData as jest.Mock;
const mockUseRouteLoaderData = useRouteLoaderData as jest.Mock;

describe('extractServerContext', () => {
  it('should extract server context from loader data', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      identity: 'user-123',
      appKey: 'test-key',
      environment: 'test',
      fetchedAt: Date.now(),
    };

    const loaderData = {
      customData: 'value',
      [TOGGLY_LOADER_KEY]: serverContext,
    };

    const result = extractServerContext(loaderData);

    expect(result).toEqual(serverContext);
  });

  it('should return undefined if no context', () => {
    const loaderData = {
      customData: 'value',
    };

    const result = extractServerContext(loaderData);

    expect(result).toBeUndefined();
  });
});

describe('hasTogglyContext', () => {
  it('should return true when context exists', () => {
    const serverContext: ServerFeatureContext = {
      flags: {},
      fetchedAt: Date.now(),
    };

    const loaderData = {
      [TOGGLY_LOADER_KEY]: serverContext,
    };

    expect(hasTogglyContext(loaderData)).toBe(true);
  });

  it('should return false when context does not exist', () => {
    const loaderData = {
      customData: 'value',
    };

    expect(hasTogglyContext(loaderData)).toBe(false);
  });

  it('should return false when context is undefined', () => {
    const loaderData = {
      [TOGGLY_LOADER_KEY]: undefined,
    };

    expect(hasTogglyContext(loaderData)).toBe(false);
  });
});

describe('TogglyScript', () => {
  it('should render script with server context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      identity: 'user-123',
      fetchedAt: 12345,
    };

    const { container } = render(<TogglyScript serverContext={serverContext} />);

    const script = container.querySelector('script');
    expect(script).toBeInTheDocument();
    expect(script?.innerHTML).toContain('window.__TOGGLY_DATA__');
    expect(script?.innerHTML).toContain('"feature1":true');
    expect(script?.innerHTML).toContain('"identity":"user-123"');
  });

  it('should include nonce when provided', () => {
    const serverContext: ServerFeatureContext = {
      flags: {},
      fetchedAt: Date.now(),
    };

    const { container } = render(
      <TogglyScript serverContext={serverContext} nonce="test-nonce" />
    );

    const script = container.querySelector('script');
    expect(script?.getAttribute('nonce')).toBe('test-nonce');
  });

  it('should return null when no server context', () => {
    const { container } = render(<TogglyScript />);

    const script = container.querySelector('script');
    expect(script).not.toBeInTheDocument();
  });

  it('should escape </script sequences in serialized context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { 'evil</script><script>alert(1)': true },
      identity: 'user</script><script>alert(1)',
      fetchedAt: 12345,
    };

    const { container } = render(<TogglyScript serverContext={serverContext} />);

    const script = container.querySelector('script');
    expect(script?.innerHTML).not.toMatch(/<\/script/i);
    expect(script?.innerHTML).toContain('<\\/script');
  });
});

describe('getWindowTogglyData', () => {
  const originalWindow = global.window;

  afterEach(() => {
    global.window = originalWindow;
  });

  it('should return window data when available', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: 12345,
    };

    (global.window as unknown as { __TOGGLY_DATA__: ServerFeatureContext }).__TOGGLY_DATA__ = serverContext;

    const result = getWindowTogglyData();

    expect(result).toEqual(serverContext);
  });

  it('should return undefined when no window data', () => {
    (global.window as unknown as { __TOGGLY_DATA__: undefined }).__TOGGLY_DATA__ = undefined;

    const result = getWindowTogglyData();

    expect(result).toBeUndefined();
  });

  it('should return undefined in SSR (no window)', () => {
    // Temporarily remove window
    const windowDescriptor = Object.getOwnPropertyDescriptor(global, 'window');
    // @ts-ignore
    delete global.window;

    const result = getWindowTogglyData();

    expect(result).toBeUndefined();

    // Restore window
    if (windowDescriptor) {
      Object.defineProperty(global, 'window', windowDescriptor);
    }
  });
});

describe('RemixTogglyProvider', () => {
  beforeEach(() => {
    mockUseLoaderData.mockReset();
    mockUseRouteLoaderData.mockReset();
  });

  it('should render with loader data context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    mockUseLoaderData.mockReturnValue({
      customData: 'value',
      [TOGGLY_LOADER_KEY]: serverContext,
    });

    render(
      <RemixTogglyProvider>
        <div data-testid="child">Hello</div>
      </RemixTogglyProvider>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('should use routeId to get context from specific route', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    mockUseRouteLoaderData.mockReturnValue({
      [TOGGLY_LOADER_KEY]: serverContext,
    });

    render(
      <RemixTogglyProvider routeId="root">
        <div data-testid="child">Hello</div>
      </RemixTogglyProvider>
    );

    expect(mockUseRouteLoaderData).toHaveBeenCalledWith('root');
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('should use fallbackContext when loader data throws', () => {
    mockUseLoaderData.mockImplementation(() => {
      throw new Error('No loader data');
    });

    const fallbackContext: ServerFeatureContext = {
      flags: { fallback: true },
      fetchedAt: Date.now(),
    };

    render(
      <RemixTogglyProvider fallbackContext={fallbackContext}>
        <div data-testid="child">Hello</div>
      </RemixTogglyProvider>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('should merge config with server context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      appKey: 'server-key',
      environment: 'production',
      fetchedAt: Date.now(),
    };

    mockUseLoaderData.mockReturnValue({
      [TOGGLY_LOADER_KEY]: serverContext,
    });

    render(
      <RemixTogglyProvider>
        <div data-testid="child">Hello</div>
      </RemixTogglyProvider>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('should use custom config when provided', () => {
    mockUseLoaderData.mockReturnValue({});

    render(
      <RemixTogglyProvider config={{ appKey: 'custom-key' }}>
        <div data-testid="child">Hello</div>
      </RemixTogglyProvider>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('should render with no config and no server context', () => {
    // Neither config nor serverContext provided — covers the false branch of
    // `config ?? (serverContext ? { appKey, environment } : undefined)`
    mockUseLoaderData.mockReturnValue({});

    render(
      <RemixTogglyProvider>
        <div data-testid="child">Hello</div>
      </RemixTogglyProvider>
    );

    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });
});

describe('useTogglyLoaderData', () => {
  beforeEach(() => {
    mockUseLoaderData.mockReset();
  });

  it('should return loader data and toggly context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    mockUseLoaderData.mockReturnValue({
      customData: 'value',
      [TOGGLY_LOADER_KEY]: serverContext,
    });

    const { result } = renderHook(() => useTogglyLoaderData());

    expect(result.current.data).toEqual({
      customData: 'value',
      [TOGGLY_LOADER_KEY]: serverContext,
    });
    expect(result.current.toggly).toEqual(serverContext);
  });

  it('should return undefined toggly when not present', () => {
    mockUseLoaderData.mockReturnValue({
      customData: 'value',
    });

    const { result } = renderHook(() => useTogglyLoaderData());

    expect(result.current.toggly).toBeUndefined();
  });
});

describe('useTogglyRouteLoaderData', () => {
  beforeEach(() => {
    mockUseRouteLoaderData.mockReset();
  });

  it('should return route loader data and toggly context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    mockUseRouteLoaderData.mockReturnValue({
      customData: 'value',
      [TOGGLY_LOADER_KEY]: serverContext,
    });

    const { result } = renderHook(() => useTogglyRouteLoaderData('root'));

    expect(result.current.data).toEqual({
      customData: 'value',
      [TOGGLY_LOADER_KEY]: serverContext,
    });
    expect(result.current.toggly).toEqual(serverContext);
    expect(mockUseRouteLoaderData).toHaveBeenCalledWith('root');
  });

  it('should handle undefined route data', () => {
    mockUseRouteLoaderData.mockReturnValue(undefined);

    const { result } = renderHook(() => useTogglyRouteLoaderData('unknown-route'));

    expect(result.current.data).toBeUndefined();
    expect(result.current.toggly).toBeUndefined();
  });
});
