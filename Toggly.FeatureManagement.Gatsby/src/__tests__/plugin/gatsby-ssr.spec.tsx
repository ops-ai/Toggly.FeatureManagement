import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Mock the store module
vi.mock('../../client/store.js', async () => {
  const actual = await vi.importActual('../../client/store.js');
  return {
    ...actual,
    initTogglyClient: vi.fn().mockResolvedValue(undefined),
  };
});

import { wrapRootElement } from '../../plugin/gatsby-ssr.js';

describe('gatsby-ssr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('wrapRootElement', () => {
    it('should wrap element with TogglyProvider', () => {
      const element = <span>SSR Content</span>;
      const options = {
        appKey: 'test-key',
        plugins: [],
      };

      const wrapped = wrapRootElement!(
        { element } as any,
        options as any
      );

      const { getByText } = render(wrapped as React.ReactElement);
      expect(getByText('SSR Content')).toBeTruthy();
    });

    it('should pass config from plugin options', () => {
      const element = <span>Content</span>;
      const options = {
        appKey: 'ssr-key',
        environment: 'Staging',
        plugins: [],
      };

      const wrapped = wrapRootElement!(
        { element } as any,
        options as any
      );

      // Should render without errors
      const { container } = render(wrapped as React.ReactElement);
      expect(container.textContent).toBe('Content');
    });
  });
});
