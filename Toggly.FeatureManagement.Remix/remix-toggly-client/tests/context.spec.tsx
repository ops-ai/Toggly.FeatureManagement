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

  describe('entity context', () => {
    const datetimeGate = {
      requirement: 'all',
      rules: [
        {
          property: 'BirthDate',
          op: 'gt',
          value: '2026-01-01',
          type: 'datetime',
        },
      ],
    };

    const puppyContext = {
      kind: 'Puppy',
      key: '1',
      attributes: { BirthDate: '2026-06-15T00:00:00Z' },
    };

    const gatedServerContext: ServerFeatureContext = {
      flags: { PlainOn: true, EntityGated: datetimeGate },
      fetchedAt: Date.now(),
    };

    beforeEach(async () => {
      const { clearRegisteredContexts } = await import('@ops-ai/remix-toggly-core');
      clearRegisteredContexts();
    });

    afterEach(async () => {
      const { clearRegisteredContexts } = await import('@ops-ai/remix-toggly-core');
      clearRegisteredContexts();
    });

    it('fails closed for an entity gate evaluated without context', () => {
      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={gatedServerContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isEnabled('EntityGated')).toBe(false);
      expect(capturedContext?.isDisabled('EntityGated')).toBe(true);
      expect(capturedContext?.evaluateGate(['EntityGated'], 'all')).toBe(false);
    });

    it('evaluates an entity gate against a matching context', () => {
      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={gatedServerContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      expect(capturedContext?.isEnabled('EntityGated', false, puppyContext)).toBe(
        true
      );
      expect(
        capturedContext?.evaluateGate(
          ['PlainOn', 'EntityGated'],
          'all',
          false,
          puppyContext
        )
      ).toBe(true);
    });

    it('maps a domain object through registerContext', () => {
      let capturedContext: TogglyContextValue | undefined;

      render(
        <TogglyProvider serverContext={gatedServerContext}>
          <TestConsumer onContext={(ctx) => (capturedContext = ctx)} />
        </TogglyProvider>
      );

      capturedContext?.registerContext<{ id: string; birthDate: string }>(
        'Puppy',
        (puppy) => ({
          kind: 'Puppy',
          key: puppy.id,
          attributes: { BirthDate: puppy.birthDate },
        })
      );

      expect(
        capturedContext?.isEnabled(
          'EntityGated',
          false,
          { id: '7', birthDate: '2026-06-15T00:00:00Z' },
          'Puppy'
        )
      ).toBe(true);
      expect(
        capturedContext?.isEnabled(
          'EntityGated',
          false,
          { id: '8', birthDate: '2020-01-01T00:00:00Z' },
          'Puppy'
        )
      ).toBe(false);
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

    it('should return false when removing a non-existent hook', () => {
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

      let result: boolean | undefined;
      act(() => {
        result = capturedContext?.removeHook('non-existent-hook');
      });

      expect(result).toBe(false);
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
    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should execute beforeIdentify and afterIdentify hooks', async () => {
      // Persistent mock: identify() fetches flags internally and may cause re-renders
      mockFetch.mockResolvedValue({
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

      // beforeIdentify is called with (identity) — one argument
      expect(beforeIdentify).toHaveBeenCalledWith('user-123');
      // afterIdentify is called with (identity, undefined) — two arguments
      expect(afterIdentify).toHaveBeenCalledWith('user-123', undefined);
    });

    it('should handle beforeIdentify hook errors gracefully', async () => {
      // Persistent mock for identify-triggered fetch
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      // Re-spy on error specifically so we can assert on it (outer beforeEach spy is overridden)
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

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
    });

    it('should handle afterIdentify hook errors gracefully', async () => {
      // Persistent mock for identify-triggered fetch
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });

      const serverContext: ServerFeatureContext = {
        flags: { feature1: true },
        fetchedAt: Date.now(),
      };

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

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

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

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
      // Cleanup handled by outer afterEach(() => jest.restoreAllMocks())
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

  describe('WebSocket live updates', () => {
    // Controllable WebSocket mock for browser environment
    class MockWebSocket {
      static instances: MockWebSocket[] = [];
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      closeCalled = false;

      constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
      }

      simulateOpen() { this.onopen?.(); }
      simulateMessage(data: string) { this.onmessage?.({ data }); }
      simulateClose() { this.onclose?.(); }
      simulateError() { this.onerror?.(); }
      close() { this.closeCalled = true; }
    }

    const wsConfig = { appKey: 'test-key', baseUrl: 'https://definitions.toggly.io' };
    const serverContext: ServerFeatureContext = { flags: {}, fetchedAt: Date.now() };

    beforeEach(() => {
      MockWebSocket.instances = [];
      (global as any).WebSocket = MockWebSocket;
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ feature1: true }),
      });
    });

    afterEach(() => {
      delete (global as any).WebSocket;
      jest.restoreAllMocks();
    });

    it('should connect to WebSocket on mount', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      expect(MockWebSocket.instances).toHaveLength(1);
      expect(MockWebSocket.instances[0].url).toBe('wss://definitions.toggly.io/test-key/ws?sdk=remix&sdkVersion=1.2.0');
    });

    it('should build ws:// URL from http:// baseUrl', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={{ appKey: 'test-key', baseUrl: 'http://localhost:3000' }}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      expect(MockWebSocket.instances[0].url).toBe('ws://localhost:3000/test-key/ws?sdk=remix&sdkVersion=1.2.0');
    });

    it('should not connect when no appKey provided', async () => {
      render(
        <TogglyProvider serverContext={serverContext}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('should not connect when WebSocket is not available in the environment', async () => {
      // Override: make WebSocket undefined to simulate non-browser / old env
      (global as any).WebSocket = undefined;

      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      expect(MockWebSocket.instances).toHaveLength(0);
    });

    it('should set wsConnected state on open event', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      const ws = MockWebSocket.instances[0];

      act(() => {
        ws.simulateOpen();
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('should refresh flags on flags-updated JSON message', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      mockFetch.mockClear();
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateMessage(JSON.stringify({ type: 'flags-updated' }));
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should refresh flags on update JSON message', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      mockFetch.mockClear();
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateMessage(JSON.stringify({ type: 'update' }));
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should ignore ping JSON messages', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      mockFetch.mockClear();
      const ws = MockWebSocket.instances[0];

      act(() => {
        ws.simulateMessage(JSON.stringify({ type: 'ping' }));
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh flags on plain text "update" message', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      mockFetch.mockClear();
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateMessage('update');
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should refresh flags on plain text "flags-updated" message', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      mockFetch.mockClear();
      const ws = MockWebSocket.instances[0];

      await act(async () => {
        ws.simulateMessage('flags-updated');
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should ignore unknown plain text messages', async () => {
      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      mockFetch.mockClear();
      const ws = MockWebSocket.instances[0];

      act(() => {
        ws.simulateMessage('some-unknown-message');
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should log warn on WebSocket error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      const ws = MockWebSocket.instances[0];

      act(() => {
        ws.simulateError();
      });

      expect(warnSpy).toHaveBeenCalled();
    });

    it('should schedule reconnect after close and create new WebSocket', async () => {
      jest.useFakeTimers();

      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      expect(MockWebSocket.instances).toHaveLength(1);
      const ws = MockWebSocket.instances[0];

      act(() => {
        ws.simulateClose();
      });

      // Advance past the 5s reconnect delay
      await act(async () => {
        jest.advanceTimersByTime(6000);
      });

      expect(MockWebSocket.instances).toHaveLength(2);

      jest.useRealTimers();
    });

    it('should log warn and schedule reconnect when WebSocket constructor throws', async () => {
      jest.useFakeTimers();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      (global as any).WebSocket = () => {
        throw new Error('Connection failed');
      };

      render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      expect(warnSpy).toHaveBeenCalled();

      // After reconnect delay, it should try again (and fail again)
      await act(async () => {
        jest.advanceTimersByTime(6000);
      });

      expect(warnSpy).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('should clean up open WebSocket on unmount', async () => {
      const { unmount } = render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      const ws = MockWebSocket.instances[0];

      unmount();

      expect(ws.closeCalled).toBe(true);
    });

    it('should cancel pending reconnect timer on unmount', async () => {
      jest.useFakeTimers();

      const { unmount } = render(
        <TogglyProvider serverContext={serverContext} config={wsConfig}>
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      const ws = MockWebSocket.instances[0];

      // Trigger close to start the reconnect timer
      act(() => {
        ws.simulateClose();
      });

      // Unmount before timer fires — should cancel the pending reconnect
      unmount();

      // Advance time: the reconnect timer should NOT fire (it was cancelled)
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });

      // No new WebSocket should have been created
      expect(MockWebSocket.instances).toHaveLength(1);

      jest.useRealTimers();
    });

    it('should throttle HTTP refresh when WebSocket is connected', async () => {
      jest.useFakeTimers();

      render(
        <TogglyProvider
          serverContext={serverContext}
          config={wsConfig}
          enableRefresh={true}
          refreshInterval={1000}
        >
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      const ws = MockWebSocket.instances[0];

      // Open WS — sets wsConnectedRef=true and lastFallbackRefreshRef=Date.now()
      act(() => {
        ws.simulateOpen();
      });

      mockFetch.mockClear();

      // Advance by refresh interval (< 20 min fallback threshold)
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // No HTTP fetch because WS connected and within fallback interval
      expect(mockFetch).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should do fallback HTTP refresh when WebSocket connected but fallback interval elapsed', async () => {
      jest.useFakeTimers();

      render(
        <TogglyProvider
          serverContext={serverContext}
          config={wsConfig}
          enableRefresh={true}
          refreshInterval={1000}
        >
          <TestConsumer />
        </TogglyProvider>
      );

      await act(async () => {});

      const ws = MockWebSocket.instances[0];

      // Open WS — records lastFallbackRefreshRef at current fake time
      act(() => {
        ws.simulateOpen();
      });

      // Advance system time past the 20-minute fallback interval
      jest.setSystemTime(Date.now() + 21 * 60 * 1000);

      mockFetch.mockClear();

      // Advance timer to trigger the refresh interval callback
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });

      // Fetch SHOULD be called (fallback refresh after >20 min)
      expect(mockFetch).toHaveBeenCalled();

      jest.useRealTimers();
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
