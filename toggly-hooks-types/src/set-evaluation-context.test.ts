import { describe, expect, it, vi } from 'vitest';
import {
  bindTogglyServiceContextState,
  setBrowserSdkEvaluationContext,
  setEvaluationContextSafely,
} from './set-evaluation-context';

describe('setEvaluationContextSafely', () => {
  it('withholds defaults then refreshes on success', async () => {
    let state = {
      identity: 'user-a',
      groups: ['beta'],
      claims: { role: 'viewer' },
      features: { Gated: true } as Record<string, boolean>,
      variants: null as Record<string, unknown> | null,
    };
    const notifyRefresh = vi.fn();
    const refreshStrict = vi.fn().mockResolvedValue(undefined);

    await setEvaluationContextSafely(
      { identity: 'user-b' },
      { Gated: false },
      {
        readState: () => ({ ...state, groups: [...state.groups], claims: { ...state.claims } }),
        writeState: (next) => {
          state = {
            identity: next.identity,
            groups: [...next.groups],
            claims: { ...next.claims },
            features: next.features as Record<string, boolean> | null,
            variants: next.variants as Record<string, unknown> | null,
          };
        },
        notifyRefresh,
        refreshStrict,
      },
    );

    expect(state.identity).toBe('user-b');
    expect(refreshStrict).toHaveBeenCalledTimes(1);
    expect(notifyRefresh).toHaveBeenCalledTimes(1);
  });

  it('restores prior snapshot when refresh fails', async () => {
    let state = {
      identity: 'user-a',
      groups: [] as string[],
      claims: {} as Record<string, string>,
      features: { Gated: true } as Record<string, boolean>,
      variants: null as Record<string, unknown> | null,
    };
    const notifyRefresh = vi.fn();
    const refreshStrict = vi.fn().mockRejectedValue(new Error('refresh failed'));

    await expect(
      setEvaluationContextSafely(
        { identity: 'user-b' },
        { Gated: false },
        {
          readState: () => ({ ...state, groups: [...state.groups], claims: { ...state.claims } }),
          writeState: (next) => {
            state = {
              identity: next.identity,
              groups: [...next.groups],
              claims: { ...next.claims },
              features: next.features as Record<string, boolean> | null,
              variants: next.variants as Record<string, unknown> | null,
            };
          },
          notifyRefresh,
          refreshStrict,
        },
      ),
    ).rejects.toThrow('refresh failed');

    expect(state.identity).toBe('user-a');
    expect(state.features).toEqual({ Gated: true });
    expect(notifyRefresh).toHaveBeenCalledTimes(2);
  });

  it('bindTogglyServiceContextState reads and writes host fields', () => {
    const host = {
      _config: { identity: 'user-a' as string | undefined },
      _groups: ['beta'],
      _claims: { role: 'viewer' },
      _features: { Gated: true } as Record<string, boolean> | null,
      _variants: null as Record<string, unknown> | null,
    };

    const bindings = bindTogglyServiceContextState(host);
    const snapshot = bindings.readState();
    expect(snapshot.identity).toBe('user-a');
    expect(snapshot.groups).toEqual(['beta']);

    bindings.writeState({
      identity: 'user-b',
      groups: ['gamma'],
      claims: { role: 'admin' },
      features: { Gated: false },
      variants: null,
    });

    expect(host._config.identity).toBe('user-b');
    expect(host._groups).toEqual(['gamma']);
    expect(host._claims).toEqual({ role: 'admin' });
    expect(host._features).toEqual({ Gated: false });
  });

  it('setBrowserSdkEvaluationContext delegates to runner hooks', async () => {
    const host = {
      _config: { identity: 'user-a' as string | undefined },
      _groups: [] as string[],
      _claims: {} as Record<string, string>,
      _features: { Gated: true } as Record<string, boolean> | null,
      _variants: null as Record<string, unknown> | null,
    };
    const notifyFeaturesRefresh = vi.fn();
    const loadFeaturesStrict = vi.fn().mockResolvedValue(undefined);

    await setBrowserSdkEvaluationContext(
      host,
      { identity: 'user-b' },
      { Gated: false },
      { notifyFeaturesRefresh, loadFeaturesStrict },
    );

    expect(host._config.identity).toBe('user-b');
    expect(loadFeaturesStrict).toHaveBeenCalledTimes(1);
    expect(notifyFeaturesRefresh).toHaveBeenCalledTimes(1);
  });
});
