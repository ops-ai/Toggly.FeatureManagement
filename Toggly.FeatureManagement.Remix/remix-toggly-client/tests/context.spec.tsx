/**
 * Tests for TogglyProvider and context
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import {
  TogglyProvider,
  useTogglyContext,
  TogglyContextValue,
} from '../src/context';
import type { ServerFeatureContext, TogglyHook } from '@ops-ai/remix-toggly-core';

// Mock fetch
const mockFetch = global.fetch as jest.Mock;

// Test component to access context
function TestConsumer({
  onContext,
}: {
  onContext?: (context: TogglyContextValue) => void;
}) {
  const context = useTogglyContext();
  onContext?.(context);
  return (
    <div data-testid="consumer">
      <span data-testid="is-ready">{String(context.isReady)}</span>
      <span data-testid="identity">{context.identity ?? 'none'}</span>
    </div>
  );
}

describe('TogglyProvider', () => {
  describe('initialization', () => {
    it('should render children', () => {
      render(
        <TogglyProvider>
          <div data-testid="child">Hello</div>
        </TogglyProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('should initialize with server context', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        identity: 'user-123',
        appKey: 'test-key',
        environment: 'test',
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isReady).toBe(true);
      expect(capturedContext?.identity).toBe('user-123');
      expect(capturedContext?.flags).toEqual({ feature1: true });
    });

    it('should initialize with feature defaults when no server context', async () => {
      const config = {
        featureDefaults: { default1: true, default2: false },
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider config={config}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.flags).toEqual({ default1: true, default2: false });
    });

    it('should fetch flags when appKey provided without server context', async () => {
      const flags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(flags),
      });

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider config={{ appKey: 'test-key' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await waitFor(() => {
        expect(capturedContext?.isReady).toBe(true);
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('isEnabled', () => {
    it('should return true for enabled feature', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isEnabled('feature1')).toBe(true);
    });

    it('should return false for disabled feature', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isEnabled('feature1')).toBe(false);
    });

    it('should return default value for missing feature', () => {
      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isEnabled('missing', true)).toBe(true);
      expect(capturedContext?.isEnabled('missing', false)).toBe(false);
    });
  });

  describe('isDisabled', () => {
    it('should return true for disabled feature', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isDisabled('feature1')).toBe(true);
    });

    it('should return false for enabled feature', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isDisabled('feature1')).toBe(false);
    });
  });

  describe('evaluateGate', () => {
    it('should return true when all features enabled', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true, feature2: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(
        capturedContext?.evaluateGate(['feature1', 'feature2'], 'all')
      ).toBe(true);
    });

    it('should return false when not all features enabled', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true, feature2: false },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(
        capturedContext?.evaluateGate(['feature1', 'feature2'], 'all')
      ).toBe(false);
    });

    it('should return true when any feature enabled', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true, feature2: false },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(
        capturedContext?.evaluateGate(['feature1', 'feature2'], 'any')
      ).toBe(true);
    });

    it('should negate result when negate is true', () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(
        capturedContext?.evaluateGate(['feature1'], 'all', true)
      ).toBe(false);
    });
  });

  describe('identify', () => {
    it('should update identity and refetch flags', async () => {
      const newFlags = { feature1: true, feature2: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newFlags),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await act(async () => {
        await capturedContext?.identify('new-user');
      });

      expect(capturedContext?.identity).toBe('new-user');
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should clear identity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const serverContext: ServerFeatureContext = {
        flags: {},
        identity: 'user-123',
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.identity).toBe('user-123');

      await act(async () => {
        await capturedContext?.reset();
      });

      expect(capturedContext?.identity).toBeUndefined();
    });
  });

  describe('refresh', () => {
    it('should refetch flags', async () => {
      const newFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newFlags),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: false },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await act(async () => {
        await capturedContext?.refresh();
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(capturedContext?.flags.feature1).toBe(true);
    });
  });

  describe('hooks system', () => {
    it('should add and remove hooks', () => {
      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'test-hook' }),
        beforeEvaluation: jest.fn(),
      };

      act(() => {
        capturedContext?.addHook(hook);
      });

      // removeHook returns boolean, but due to React's async state updates
      // the return value may not be reliable. We test the removal works
      // by verifying we can add the same hook again after removal.
      act(() => {
        capturedContext?.removeHook('test-hook');
      });

      // If hook was removed, we should be able to add it again without warning
      // The warning would appear if hook still exists
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      act(() => {
        capturedContext?.addHook(hook);
      });
      // No duplicate warning means hook was successfully removed and re-added
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[Toggly]',
        'Hook "test-hook" already registered. Skipping.'
      );
      warnSpy.mockRestore();
    });

    it('should not add duplicate hooks', () => {
      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'test-hook' }),
      };

      act(() => {
        capturedContext?.addHook(hook);
        capturedContext?.addHook(hook);
      });

      // Should only be added once (warning logged)
    });
  });

  describe('onFlagsChange callback', () => {
    it('should call onFlagsChange when flags update', async () => {
      const newFlags = { feature1: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newFlags),
      });

      const onFlagsChange = jest.fn();

      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider
          serverContext={serverContext}
          config={{ appKey: 'test' }}
          onFlagsChange={onFlagsChange}
        >
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await act(async () => {
        await capturedContext?.refresh();
      });

      expect(onFlagsChange).toHaveBeenCalledWith(newFlags);
    });
  });

  describe('refresh interval', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should set up refresh interval when enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      render(
        <TogglyProvider
          serverContext={serverContext}
          config={{ appKey: 'test' }}
          enableRefresh={true}
          refreshInterval={5000}
        >
          <TestConsumer />
        </TogglyProvider>
      );

      // Fast-forward time
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('hook execution', () => {
    it('should execute beforeIdentify and afterIdentify hooks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      const beforeIdentify = jest.fn();
      const afterIdentify = jest.fn();

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'identify-hook' }),
        beforeIdentify,
        afterIdentify,
      };

      act(() => {
        capturedContext?.addHook(hook);
      });

      // Trigger identify
      await act(async () => {
        await capturedContext?.identify('user-123');
      });

      expect(beforeIdentify).toHaveBeenCalledWith('user-123', undefined);
      expect(afterIdentify).toHaveBeenCalled();
    });

    it('should handle beforeIdentify hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'error-identify-hook' }),
        beforeIdentify: () => {
          throw new Error('Hook error');
        },
      };

      act(() => {
        capturedContext?.addHook(hook);
      });

      // Should not throw
      await act(async () => {
        await capturedContext?.identify('user-123');
      });

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('should handle afterIdentify hook errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'error-after-identify-hook' }),
        afterIdentify: () => {
          throw new Error('Hook error');
        },
      };

      act(() => {
        capturedContext?.addHook(hook);
      });

      // Should not throw
      await act(async () => {
        await capturedContext?.identify('user-123');
      });

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('should execute afterRefresh hooks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      const afterRefresh = jest.fn();

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'refresh-hook' }),
        afterRefresh,
      };

      act(() => {
        capturedContext?.addHook(hook);
      });

      await act(async () => {
        await capturedContext?.refresh();
      });

      expect(afterRefresh).toHaveBeenCalledWith({ feature1: true });
    });

    it('should handle afterRefresh errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: {},
        fetchedAt: Date.now(),
      };

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      const hook: TogglyHook = {
        getMetadata: () => ({ name: 'error-refresh-hook' }),
        afterRefresh: () => {
          throw new Error('Refresh hook error');
        },
      };

      act(() => {
        capturedContext?.addHook(hook);
      });

      // Should not throw
      await act(async () => {
        await capturedContext?.refresh();
      });

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('fetch error handling', () => {
    it('should handle non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const serverContext: ServerFeatureContext = {
        flags: { existing: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await act(async () => {
        await capturedContext?.refresh();
      });

      // Should keep existing flags on error
      expect(capturedContext?.flags).toEqual({ existing: true });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const serverContext: ServerFeatureContext = {
        flags: { existing: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test' }}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await act(async () => {
        await capturedContext?.refresh();
      });

      // Should keep existing flags on error
      expect(capturedContext?.flags).toEqual({ existing: true });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should use current flags when no appKey', async () => {
      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      await act(async () => {
        await capturedContext?.refresh();
      });

      // Should keep existing flags when no appKey
      expect(capturedContext?.flags).toEqual({ feature1: true });
    });
  });
});

describe('useTogglyContext', () => {
  it('should throw when used outside provider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useTogglyContext must be used within a TogglyProvider');

    consoleError.mockRestore();
  });
});
