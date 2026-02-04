import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useToggly } from '../../hooks/useToggly.js';
import { $flags, $isReady, $error } from '../../client/store.js';

function TestComponent() {
  const { flags, isReady, error, refreshFlags, setIdentity, clearIdentity } = useToggly();
  return (
    <div>
      <span data-testid="flags">{JSON.stringify(flags)}</span>
      <span data-testid="ready">{String(isReady)}</span>
      <span data-testid="error">{error ? error.message : 'none'}</span>
      <span data-testid="hasRefresh">{String(typeof refreshFlags === 'function')}</span>
      <span data-testid="hasSetId">{String(typeof setIdentity === 'function')}</span>
      <span data-testid="hasClearId">{String(typeof clearIdentity === 'function')}</span>
    </div>
  );
}

describe('useToggly', () => {
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

  it('should return flags', () => {
    $flags.set({ F1: true, F2: false });

    render(<TestComponent />);

    expect(JSON.parse(screen.getByTestId('flags').textContent!)).toEqual({
      F1: true,
      F2: false,
    });
  });

  it('should return isReady state', () => {
    $isReady.set(true);

    render(<TestComponent />);

    expect(screen.getByTestId('ready').textContent).toBe('true');
  });

  it('should return error state', () => {
    $error.set(new Error('Store error'));

    render(<TestComponent />);

    expect(screen.getByTestId('error').textContent).toBe('Store error');
  });

  it('should return refreshFlags function', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('hasRefresh').textContent).toBe('true');
  });

  it('should return setIdentity function', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('hasSetId').textContent).toBe('true');
  });

  it('should return clearIdentity function', () => {
    render(<TestComponent />);

    expect(screen.getByTestId('hasClearId').textContent).toBe('true');
  });
});
