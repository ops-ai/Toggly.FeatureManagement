import { describe, expect, it, vi } from 'vitest';
import { setEvaluationContextSafely } from './set-evaluation-context';

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
});
