import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useFeatureFlag } from '../../hooks/useFeatureFlag.js';
import { $flags, $isReady, $error } from '../../client/store.js';

function TestComponent({ flagKey, defaultValue }: { flagKey: string; defaultValue?: boolean }) {
  const { isEnabled, isReady, error } = useFeatureFlag(flagKey, defaultValue);
  return (
    <div>
      <span data-testid="enabled">{String(isEnabled)}</span>
      <span data-testid="ready">{String(isReady)}</span>
      <span data-testid="error">{error ? error.message : 'none'}</span>
    </div>
  );
}

describe('useFeatureFlag', () => {
  beforeEach(() => {
    $flags.set({});
    $isReady.set(false);
    $error.set(null);
  });

  afterEach(() => {
    $flags.set({});
    $isReady.set(false);
    $error.set(null);
  });

  it('should return true for enabled flag', () => {
    $flags.set({ F1: true });
    $isReady.set(true);

    render(<TestComponent flagKey="F1" />);

    expect(screen.getByTestId('enabled').textContent).toBe('true');
  });

  it('should return false for disabled flag', () => {
    $flags.set({ F1: false });
    $isReady.set(true);

    render(<TestComponent flagKey="F1" />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('should return default value for missing flag', () => {
    $flags.set({});
    $isReady.set(true);

    render(<TestComponent flagKey="Unknown" defaultValue={true} />);

    expect(screen.getByTestId('enabled').textContent).toBe('true');
  });

  it('should return false as default when not specified', () => {
    $flags.set({});
    $isReady.set(true);

    render(<TestComponent flagKey="Unknown" />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('should return isReady state', () => {
    $isReady.set(false);

    render(<TestComponent flagKey="F1" />);

    expect(screen.getByTestId('ready').textContent).toBe('false');
  });

  it('should return error state', () => {
    $error.set(new Error('Test error'));
    $isReady.set(true);

    render(<TestComponent flagKey="F1" />);

    expect(screen.getByTestId('error').textContent).toBe('Test error');
  });

  it('should return no error when none exists', () => {
    $isReady.set(true);

    render(<TestComponent flagKey="F1" />);

    expect(screen.getByTestId('error').textContent).toBe('none');
  });
});
