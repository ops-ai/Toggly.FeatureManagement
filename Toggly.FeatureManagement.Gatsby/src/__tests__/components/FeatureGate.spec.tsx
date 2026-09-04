import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { FeatureGate } from '../../components/FeatureGate.js';
import { $flags, $isReady } from '../../client/store.js';

describe('FeatureGate Component', () => {
  beforeEach(() => {
    $flags.set({});
    $isReady.set(true);
  });

  afterEach(() => {
    $flags.set({});
    $isReady.set(false);
  });

  it('should render children when all flags are enabled', () => {
    $flags.set({ F1: true, F2: true });

    render(
      <FeatureGate flags={['F1', 'F2']} requirement="all">
        <span>All Enabled</span>
      </FeatureGate>
    );

    expect(screen.getByText('All Enabled')).toBeTruthy();
  });

  it('should not render when "all" requirement not met', () => {
    $flags.set({ F1: true, F2: false });

    const { container } = render(
      <FeatureGate flags={['F1', 'F2']} requirement="all">
        <span>Content</span>
      </FeatureGate>
    );

    expect(container.textContent).toBe('');
  });

  it('should render children when "any" requirement met', () => {
    $flags.set({ F1: true, F2: false });

    render(
      <FeatureGate flags={['F1', 'F2']} requirement="any">
        <span>Any Enabled</span>
      </FeatureGate>
    );

    expect(screen.getByText('Any Enabled')).toBeTruthy();
  });

  it('should not render when "any" requirement not met', () => {
    $flags.set({ F1: false, F2: false });

    const { container } = render(
      <FeatureGate flags={['F1', 'F2']} requirement="any">
        <span>Content</span>
      </FeatureGate>
    );

    expect(container.textContent).toBe('');
  });

  it('should support negate', () => {
    $flags.set({ F1: true });

    const { container } = render(
      <FeatureGate flags={['F1']} requirement="all" negate={true}>
        <span>Negated</span>
      </FeatureGate>
    );

    expect(container.textContent).toBe('');
  });

  it('should render when negated and flag disabled', () => {
    $flags.set({ F1: false });

    render(
      <FeatureGate flags={['F1']} requirement="all" negate={true}>
        <span>Negated Shows</span>
      </FeatureGate>
    );

    expect(screen.getByText('Negated Shows')).toBeTruthy();
  });

  it('should render children for empty flags array', () => {
    render(
      <FeatureGate flags={[]}>
        <span>Empty Gate</span>
      </FeatureGate>
    );

    expect(screen.getByText('Empty Gate')).toBeTruthy();
  });

  it('should hide for empty flags with negate', () => {
    const { container } = render(
      <FeatureGate flags={[]} negate={true}>
        <span>Content</span>
      </FeatureGate>
    );

    expect(container.textContent).toBe('');
  });

  it('should render loading when not ready', () => {
    $isReady.set(false);
    $flags.set({ F1: true });

    render(
      <FeatureGate flags={['F1']} loading={<span>Loading</span>}>
        <span>Content</span>
      </FeatureGate>
    );

    expect(screen.getByText('Loading')).toBeTruthy();
    expect(screen.queryByText('Content')).toBeNull();
  });

  it('should render nothing when gate not met', () => {
    $flags.set({ F1: false });

    const { container } = render(
      <FeatureGate flags={['F1']}>
        <span>Main Content</span>
      </FeatureGate>
    );

    expect(container.textContent).toBe('');
  });
});
