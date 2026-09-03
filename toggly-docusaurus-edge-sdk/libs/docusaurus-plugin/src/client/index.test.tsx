// @vitest-environment jsdom

/**
 * Tests for the React client bindings, focused on the edge-snapshot contract:
 * the first client render must match the post-edge-strip DOM so React 18
 * hydration succeeds without a recoverable-error / full client re-render.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import {
  TogglyProvider,
  Feature,
  readEdgeFlagsSnapshot,
} from './index';
import type { Flags } from '../lib/toggly-client';

const SNAPSHOT_GLOBAL = '__TOGGLY_EDGE_FLAGS__';

function setSnapshot(value: unknown): void {
  (window as unknown as Record<string, unknown>)[SNAPSHOT_GLOBAL] = value;
}

function clearSnapshot(): void {
  delete (window as unknown as Record<string, unknown>)[SNAPSHOT_GLOBAL];
}

/**
 * Render under TogglyProvider and flush the post-render microtask so the
 * provider's `client.getFlags()` resolution settles inside `act()`. We pass
 * `flagDefaults` matching the snapshot so the live-fetch result agrees with
 * the snapshot — that mirrors production (edge and client hit the same
 * Toggly API and resolve identically).
 */
async function renderWithProvider(ui: React.ReactNode, flagDefaults: Flags = {}) {
  const result = render(
    <TogglyProvider config={{ flagDefaults }}>{ui}</TogglyProvider>,
  );
  // Flush the no-appKey getFlags() promise so the act warning doesn't fire.
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // TogglyProvider warns when no appKey is configured.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  clearSnapshot();
  warnSpy.mockRestore();
  cleanup();
});

describe('readEdgeFlagsSnapshot', () => {
  it('returns null when no snapshot is present', () => {
    clearSnapshot();
    expect(readEdgeFlagsSnapshot()).toBeNull();
  });

  it('returns a sanitized Flags map when the snapshot is a plain object', () => {
    setSnapshot({ flagA: true, flagB: false });
    expect(readEdgeFlagsSnapshot()).toEqual({ flagA: true, flagB: false });
  });

  it('drops non-boolean entries to defend against tampering', () => {
    setSnapshot({ good: true, bad: 'yes', also_bad: 1, nope: null });
    expect(readEdgeFlagsSnapshot()).toEqual({ good: true });
  });

  it('returns null for non-object snapshot values', () => {
    setSnapshot('not-an-object');
    expect(readEdgeFlagsSnapshot()).toBeNull();
  });
});

describe('Feature with edge snapshot', () => {
  it('renders the wrapper for an enabled snapshot flag (matches edge-kept DOM)', async () => {
    setSnapshot({ flagA: true });

    const { container, getByText } = await renderWithProvider(
      <Feature flag="flagA">A-content</Feature>,
      { flagA: true },
    );

    expect(getByText('A-content')).toBeTruthy();
    expect(container.querySelector('[data-feature="flagA"]')).not.toBeNull();
  });

  it('renders nothing for a disabled snapshot flag (matches edge-stripped DOM)', async () => {
    setSnapshot({ flagB: false });

    const { container, queryByText } = await renderWithProvider(
      <Feature flag="flagB">B-content</Feature>,
      { flagB: false },
    );

    expect(queryByText('B-content')).toBeNull();
    expect(container.querySelector('[data-feature="flagB"]')).toBeNull();
  });

  it('renders nothing for a disabled snapshot flag without fallback', async () => {
    setSnapshot({ flagB: false });

    const { container, queryByText } = await renderWithProvider(
      <Feature flag="flagB">B-content</Feature>,
      { flagB: false },
    );

    expect(queryByText('B-content')).toBeNull();
    expect(container.querySelector('[data-feature="flagB"]')).toBeNull();
  });

  it('renders children when negate is set and the snapshot flag is off', async () => {
    setSnapshot({ flagB: false });

    const { getByText } = await renderWithProvider(
      <Feature flag="flagB" negate>
        Off-path
      </Feature>,
      { flagB: false },
    );

    expect(getByText('Off-path')).toBeTruthy();
  });

  it('renders the wrapper on first render when no snapshot is present (legacy / no edge worker)', async () => {
    clearSnapshot();

    // We assert against the SYNCHRONOUS first render output, which is what
    // hydrates against the DOM. In the no-snapshot scenario the page is the
    // untransformed origin HTML (all wrappers present), so the React tree
    // must match that.
    const { container, getByText } = render(
      <TogglyProvider config={{}}>
        <Feature flag="anything">legacy-content</Feature>
      </TogglyProvider>,
    );

    expect(getByText('legacy-content')).toBeTruthy();
    expect(container.querySelector('[data-feature="anything"]')).not.toBeNull();

    // Flush the post-render microtask inside `act()` so React does not warn
    // about unwrapped state updates from `client.getFlags()` resolving. The
    // post-resolve render correctly removes the wrapper (unknown flag falls
    // back to defaultValue=false) — that's a normal state transition, not a
    // hydration concern.
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('honors the `as` prop on the wrapper element', async () => {
    setSnapshot({ flagA: true });

    const { container } = await renderWithProvider(
      <ul>
        <Feature flag="flagA" as="li">
          A
        </Feature>
      </ul>,
      { flagA: true },
    );

    const li = container.querySelector('li[data-feature="flagA"]');
    expect(li).not.toBeNull();
  });
});
