/**
 * Tests for React hooks
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { TogglyProvider } from '../src/context';
import {
  useToggly,
  useFeature,
  useFeatureDisabled,
  useFeatureGate,
  useFeatureFlags,
  useFeatures,
  useFeatureCallback,
  useFeatureValue,
  useIdentity,
  useTogglyReady,
  useRefreshFlags,
  useFeatureRender,
  useABTest,
  useFeatureWithLoading,
  useFeatureChange,
} from '../src/hooks';
import type { ServerFeatureContext } from '@ops-ai/remix-toggly-core';

// Helper to create wrapper with provider
const createWrapper = (serverContext: ServerFeatureContext) => {
  return ({ children }: { children: React.ReactNode }) => (
    <TogglyProvider serverContext={serverContext}>{children}</TogglyProvider>
  );
};

describe('useToggly', () => {
  it('should return the full context', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      identity: 'user-123',
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useToggly(), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current.flags).toEqual({ feature1: true });
    expect(result.current.identity).toBe('user-123');
    expect(result.current.isReady).toBe(true);
    expect(typeof result.current.isEnabled).toBe('function');
    expect(typeof result.current.isDisabled).toBe('function');
    expect(typeof result.current.evaluateGate).toBe('function');
    expect(typeof result.current.identify).toBe('function');
    expect(typeof result.current.reset).toBe('function');
    expect(typeof result.current.refresh).toBe('function');
  });
});

describe('useFeature', () => {
  it('should return true for enabled feature', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useFeature('feature1'), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(true);
  });

  it('should return false for disabled feature', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useFeature('feature1'), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(false);
  });

  it('should return default value for missing feature', () => {
    const serverContext: ServerFeatureContext = {
      flags: {},
      fetchedAt: Date.now(),
    };

    const { result: result1 } = renderHook(() => useFeature('missing', true), {
      wrapper: createWrapper(serverContext),
    });
    expect(result1.current).toBe(true);

    const { result: result2 } = renderHook(() => useFeature('missing', false), {
      wrapper: createWrapper(serverContext),
    });
    expect(result2.current).toBe(false);
  });
});

describe('useFeatureDisabled', () => {
  it('should return true for disabled feature', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useFeatureDisabled('feature1'), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(true);
  });

  it('should return false for enabled feature', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useFeatureDisabled('feature1'), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(false);
  });
});

describe('useFeatureGate', () => {
  it('should return true when all features enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatureGate(['feature1', 'feature2'], 'all'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe(true);
  });

  it('should return false when not all features enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: false },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatureGate(['feature1', 'feature2'], 'all'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe(false);
  });

  it('should return true when any feature enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: false },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatureGate(['feature1', 'feature2'], 'any'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe(true);
  });

  it('should negate result when specified', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatureGate(['feature1'], 'all', true),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe(false);
  });

  it('should default to "all" requirement when not specified', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: false },
      fetchedAt: Date.now(),
    };

    // Called without requirement arg — uses default 'all'
    const { result } = renderHook(
      () => useFeatureGate(['feature1', 'feature2']),
      { wrapper: createWrapper(serverContext) }
    );

    // 'all' requires both true — feature2 is false, so result is false
    expect(result.current).toBe(false);
  });
});

describe('useFeatureFlags', () => {
  it('should return all flags', () => {
    const flags = { feature1: true, feature2: false, feature3: true };
    const serverContext: ServerFeatureContext = {
      flags,
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toEqual(flags);
  });
});

describe('useFeatures', () => {
  it('should return multiple feature states', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true, feature2: false, feature3: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatures(['feature1', 'feature2', 'feature4']),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toEqual({
      feature1: true,
      feature2: false,
      feature4: false,
    });
  });
});

describe('useFeatureCallback', () => {
  it('should call enabled callback when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const enabledCb = jest.fn().mockReturnValue('enabled');
    const disabledCb = jest.fn().mockReturnValue('disabled');

    const { result } = renderHook(
      () => useFeatureCallback('feature1', enabledCb, disabledCb),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe('enabled');
    expect(enabledCb).toHaveBeenCalled();
    expect(disabledCb).not.toHaveBeenCalled();
  });

  it('should call disabled callback when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    const enabledCb = jest.fn().mockReturnValue('enabled');
    const disabledCb = jest.fn().mockReturnValue('disabled');

    const { result } = renderHook(
      () => useFeatureCallback('feature1', enabledCb, disabledCb),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe('disabled');
    expect(enabledCb).not.toHaveBeenCalled();
    expect(disabledCb).toHaveBeenCalled();
  });
});

describe('useFeatureValue', () => {
  it('should return enabled value when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatureValue('feature1', 'enabled-value', 'disabled-value'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe('enabled-value');
  });

  it('should return disabled value when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useFeatureValue('feature1', 'enabled-value', 'disabled-value'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe('disabled-value');
  });
});

describe('useIdentity', () => {
  it('should return identity and functions', () => {
    const serverContext: ServerFeatureContext = {
      flags: {},
      identity: 'user-123',
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useIdentity(), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current.identity).toBe('user-123');
    expect(typeof result.current.identify).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });
});

describe('useTogglyReady', () => {
  it('should return true when ready', () => {
    const serverContext: ServerFeatureContext = {
      flags: {},
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useTogglyReady(), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(true);
  });
});

describe('useRefreshFlags', () => {
  it('should return refresh function', () => {
    const serverContext: ServerFeatureContext = {
      flags: {},
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useRefreshFlags(), {
      wrapper: createWrapper(serverContext),
    });

    expect(typeof result.current).toBe('function');
  });
});

describe('useFeatureRender', () => {
  it('should return enabled element when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const EnabledComponent = () => <div>Enabled</div>;
    const DisabledComponent = () => <div>Disabled</div>;

    const { result } = renderHook(
      () => useFeatureRender('feature1', <EnabledComponent />, <DisabledComponent />),
      { wrapper: createWrapper(serverContext) }
    );

    render(<>{result.current}</>);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('should return disabled element when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    const EnabledComponent = () => <div>Enabled</div>;
    const DisabledComponent = () => <div>Disabled</div>;

    const { result } = renderHook(
      () => useFeatureRender('feature1', <EnabledComponent />, <DisabledComponent />),
      { wrapper: createWrapper(serverContext) }
    );

    render(<>{result.current}</>);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});

describe('useABTest', () => {
  it('should return variant A when feature is disabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { 'ab-test': false },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useABTest('ab-test', 'Variant A', 'Variant B'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe('Variant A');
  });

  it('should return variant B when feature is enabled', () => {
    const serverContext: ServerFeatureContext = {
      flags: { 'ab-test': true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(
      () => useABTest('ab-test', 'Variant A', 'Variant B'),
      { wrapper: createWrapper(serverContext) }
    );

    expect(result.current).toBe('Variant B');
  });
});

describe('useFeatureWithLoading', () => {
  it('should return enabled and loading state', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const { result } = renderHook(() => useFeatureWithLoading('feature1'), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useFeatureChange', () => {
  it('should return enabled state and track changes', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: true },
      fetchedAt: Date.now(),
    };

    const onChange = jest.fn();

    const { result } = renderHook(() => useFeatureChange('feature1', onChange), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(true);
  });

  it('should return false for disabled feature', () => {
    const serverContext: ServerFeatureContext = {
      flags: { feature1: false },
      fetchedAt: Date.now(),
    };

    const onChange = jest.fn();

    const { result } = renderHook(() => useFeatureChange('feature1', onChange), {
      wrapper: createWrapper(serverContext),
    });

    expect(result.current).toBe(false);
  });
});
