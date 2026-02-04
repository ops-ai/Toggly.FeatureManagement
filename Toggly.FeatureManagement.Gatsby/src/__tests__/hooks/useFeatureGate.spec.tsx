import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useFeatureGate } from '../../hooks/useFeatureGate.js';
import { $flags, $isReady, $error } from '../../client/store.js';
import type { GateRequirement } from '../../types/index.js';

function TestComponent({
  flagKeys,
  requirement,
  negate,
}: {
  flagKeys: string[];
  requirement?: GateRequirement;
  negate?: boolean;
}) {
  const { isEnabled, isReady, error } = useFeatureGate(flagKeys, requirement, negate);
  return (
    <div>
      <span data-testid="enabled">{String(isEnabled)}</span>
      <span data-testid="ready">{String(isReady)}</span>
      <span data-testid="error">{error ? error.message : 'none'}</span>
    </div>
  );
}

describe('useFeatureGate', () => {
  beforeEach(() => {
    $flags.set({});
    $isReady.set(true);
    $error.set(null);
  });

  afterEach(() => {
    $flags.set({});
    $isReady.set(false);
    $error.set(null);
  });

  it('should evaluate "all" requirement - all true', () => {
    $flags.set({ F1: true, F2: true });

    render(<TestComponent flagKeys={['F1', 'F2']} requirement="all" />);

    expect(screen.getByTestId('enabled').textContent).toBe('true');
  });

  it('should evaluate "all" requirement - one false', () => {
    $flags.set({ F1: true, F2: false });

    render(<TestComponent flagKeys={['F1', 'F2']} requirement="all" />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('should evaluate "any" requirement', () => {
    $flags.set({ F1: true, F2: false });

    render(<TestComponent flagKeys={['F1', 'F2']} requirement="any" />);

    expect(screen.getByTestId('enabled').textContent).toBe('true');
  });

  it('should evaluate "any" requirement - all false', () => {
    $flags.set({ F1: false, F2: false });

    render(<TestComponent flagKeys={['F1', 'F2']} requirement="any" />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('should support negate', () => {
    $flags.set({ F1: true });

    render(<TestComponent flagKeys={['F1']} requirement="all" negate={true} />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('should return true for empty keys without negate', () => {
    render(<TestComponent flagKeys={[]} />);

    expect(screen.getByTestId('enabled').textContent).toBe('true');
  });

  it('should return false for empty keys with negate', () => {
    render(<TestComponent flagKeys={[]} negate={true} />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });

  it('should return isReady state', () => {
    $isReady.set(false);

    render(<TestComponent flagKeys={['F1']} />);

    expect(screen.getByTestId('ready').textContent).toBe('false');
  });

  it('should return error state', () => {
    $error.set(new Error('Gate error'));

    render(<TestComponent flagKeys={['F1']} />);

    expect(screen.getByTestId('error').textContent).toBe('Gate error');
  });

  it('should default to "all" requirement', () => {
    $flags.set({ F1: true, F2: false });

    render(<TestComponent flagKeys={['F1', 'F2']} />);

    expect(screen.getByTestId('enabled').textContent).toBe('false');
  });
});
