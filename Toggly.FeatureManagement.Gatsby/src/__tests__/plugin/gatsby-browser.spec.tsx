import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock the store module
vi.mock('../../client/store.js', async () => {
  const actual = await vi.importActual('../../client/store.js');
  return {
    ...actual,
    initTogglyClient: vi.fn().mockResolvedValue(undefined),
  };
});

import { onClientEntry, wrapRootElement } from '../../plugin/gatsby-browser.js';
import { initTogglyClient } from '../../client/store.js';

describe('gatsby-browser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onClientEntry', () => {
    it('should call initTogglyClient with plugin options', () => {
      const options = {
        appKey: 'test-key',
        environment: 'Production',
        plugins: [],
      };

      onClientEntry!({} as any, options as any);

      expect(initTogglyClient).toHaveBeenCalledWith(options);
    });

    it('should log in debug mode', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const options = {
        appKey: 'test-key',
        isDebug: true,
        plugins: [],
      };

      onClientEntry!({} as any, options as any);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Initializing client')
      );
    });

    it('should handle initialization error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(initTogglyClient).mockRejectedValueOnce(new Error('Init failed'));

      onClientEntry!({} as any, { appKey: 'bad', plugins: [] } as any);

      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to initialize'),
          expect.any(Error)
        );
      });
    });
  });

  describe('wrapRootElement', () => {
    it('should wrap element with TogglyProvider', () => {
      const element = <span>App Content</span>;
      const options = {
        appKey: 'test-key',
        plugins: [],
      };

      const wrapped = wrapRootElement!(
        { element } as any,
        options as any
      );

      const { getByText } = render(wrapped as React.ReactElement);
      expect(getByText('App Content')).toBeTruthy();
    });
  });
});
