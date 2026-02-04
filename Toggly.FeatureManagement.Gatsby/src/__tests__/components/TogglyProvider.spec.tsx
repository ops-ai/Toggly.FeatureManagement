import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock the store module to intercept initTogglyClient calls
vi.mock('../../client/store.js', async () => {
  const actual = await vi.importActual('../../client/store.js');
  return {
    ...actual,
    initTogglyClient: vi.fn().mockResolvedValue(undefined),
  };
});

import { TogglyProvider } from '../../components/TogglyProvider.js';
import { initTogglyClient } from '../../client/store.js';

describe('TogglyProvider Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render children', () => {
    render(
      <TogglyProvider config={{ appKey: 'test-key' }}>
        <span>App Content</span>
      </TogglyProvider>
    );

    expect(screen.getByText('App Content')).toBeTruthy();
  });

  it('should call initTogglyClient with config', async () => {
    const config = { appKey: 'test-key', environment: 'Staging' };

    render(
      <TogglyProvider config={config}>
        <span>Content</span>
      </TogglyProvider>
    );

    // Wait for useEffect
    await vi.waitFor(() => {
      expect(initTogglyClient).toHaveBeenCalledWith(config);
    });
  });

  it('should only initialize once', async () => {
    const config = { appKey: 'test-key' };

    const { rerender } = render(
      <TogglyProvider config={config}>
        <span>Content</span>
      </TogglyProvider>
    );

    await vi.waitFor(() => {
      expect(initTogglyClient).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TogglyProvider config={config}>
        <span>Content Updated</span>
      </TogglyProvider>
    );

    // Should still be called only once due to useRef guard
    expect(initTogglyClient).toHaveBeenCalledTimes(1);
  });

  it('should handle initTogglyClient error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(initTogglyClient).mockRejectedValueOnce(new Error('Init failed'));

    render(
      <TogglyProvider config={{ appKey: 'bad-key' }}>
        <span>Content</span>
      </TogglyProvider>
    );

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize'),
        expect.any(Error)
      );
    });
  });
});
