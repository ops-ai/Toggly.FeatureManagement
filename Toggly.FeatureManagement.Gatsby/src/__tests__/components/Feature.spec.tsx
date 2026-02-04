import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Feature } from '../../components/Feature.js';
import { $flags, $isReady } from '../../client/store.js';

describe('Feature Component', () => {
  beforeEach(() => {
    $flags.set({});
    $isReady.set(false);
  });

  afterEach(() => {
    $flags.set({});
    $isReady.set(false);
  });

  it('should render children when flag is enabled and ready', () => {
    $flags.set({ F1: true });
    $isReady.set(true);

    render(
      <Feature flag="F1">
        <span>Enabled Content</span>
      </Feature>
    );

    expect(screen.getByText('Enabled Content')).toBeTruthy();
  });

  it('should not render children when flag is disabled', () => {
    $flags.set({ F1: false });
    $isReady.set(true);

    const { container } = render(
      <Feature flag="F1">
        <span>Hidden Content</span>
      </Feature>
    );

    expect(container.textContent).toBe('');
  });

  it('should render fallback when flag is disabled', () => {
    $flags.set({ F1: false });
    $isReady.set(true);

    render(
      <Feature flag="F1" fallback={<span>Fallback</span>}>
        <span>Main Content</span>
      </Feature>
    );

    expect(screen.getByText('Fallback')).toBeTruthy();
    expect(screen.queryByText('Main Content')).toBeNull();
  });

  it('should render fallback when not ready', () => {
    $flags.set({ F1: true });
    $isReady.set(false);

    render(
      <Feature flag="F1" fallback={<span>Loading</span>}>
        <span>Content</span>
      </Feature>
    );

    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByText('Content')).toBeNull();
  });

  it('should render nothing when not ready and no fallback', () => {
    $isReady.set(false);

    const { container } = render(
      <Feature flag="F1">
        <span>Content</span>
      </Feature>
    );

    expect(container.textContent).toBe('');
  });

  it('should handle missing flag key', () => {
    $flags.set({ F1: true });
    $isReady.set(true);

    const { container } = render(
      <Feature flag="Unknown">
        <span>Content</span>
      </Feature>
    );

    expect(container.textContent).toBe('');
  });
});
