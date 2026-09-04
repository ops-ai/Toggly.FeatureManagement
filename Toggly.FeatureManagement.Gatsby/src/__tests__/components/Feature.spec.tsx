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

  it('should render children when negate and flag is disabled', () => {
    $flags.set({ F1: false });
    $isReady.set(true);

    render(
      <Feature flag="F1" negate>
        <span>Off Path</span>
      </Feature>
    );

    expect(screen.getByText('Off Path')).toBeTruthy();
  });

  it('should hide children when negate and flag is enabled', () => {
    $flags.set({ F1: true });
    $isReady.set(true);

    const { container } = render(
      <Feature flag="F1" negate>
        <span>Hidden</span>
      </Feature>
    );

    expect(container.textContent).toBe('');
  });

  it('should render loading when not ready', () => {
    $flags.set({ F1: true });
    $isReady.set(false);

    render(
      <Feature flag="F1" loading={<span>Loading</span>}>
        <span>Content</span>
      </Feature>
    );

    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByText('Content')).toBeNull();
  });

  it('should render nothing when not ready and no loading', () => {
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
