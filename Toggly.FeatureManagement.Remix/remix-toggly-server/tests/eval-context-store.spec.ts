import {
  getAmbientEvalOverrides,
  mergeIdentityContext,
  runWithEvalContext,
} from '../src/eval-context-store';

describe('mergeIdentityContext', () => {
  it('returns per-call when ambient is missing', () => {
    expect(mergeIdentityContext(undefined, { identity: 'a' })).toEqual({
      identity: 'a',
    });
  });

  it('returns ambient when per-call is missing', () => {
    expect(mergeIdentityContext({ identity: 'a' }, undefined)).toEqual({
      identity: 'a',
    });
  });

  it('lets per-call fields win field-by-field', () => {
    expect(
      mergeIdentityContext(
        { identity: 'ambient', claims: { role: 'user' } },
        { identity: 'override' },
      ),
    ).toEqual({
      identity: 'override',
      groups: undefined,
      claims: { role: 'user' },
      traits: undefined,
      request: undefined,
    });
  });

  it('keeps ambient claims/request when per-call omits those keys entirely', () => {
    const ambient = { identity: 'alice', claims: { role: 'admin' } };
    const merged = mergeIdentityContext(ambient, { identity: 'bob' });
    expect(merged?.claims).toEqual({ role: 'admin' });
  });

  it('keeps ambient claims when per-call has the key present but undefined (e.g. optional field)', () => {
    // Common TS pattern: `{ identity: user.id, claims: user.claims }` where
    // `user.claims` is optional and happens to be undefined this call.
    const ambient = { identity: 'alice', claims: { role: 'admin' } };
    const someUser: { id: string; claims?: Record<string, string> } = {
      id: 'bob',
    };
    const perCall = { identity: someUser.id, claims: someUser.claims };

    expect(Object.prototype.hasOwnProperty.call(perCall, 'claims')).toBe(true);

    const merged = mergeIdentityContext(ambient, perCall);
    expect(merged).toEqual({
      identity: 'bob',
      groups: undefined,
      claims: { role: 'admin' },
      traits: undefined,
      request: undefined,
    });
  });
});

describe('ambient EvalContext store', () => {
  it('exposes nothing outside a bind', () => {
    expect(getAmbientEvalOverrides()).toBeUndefined();
  });

  it('isolates nested binds and restores the outer context after', async () => {
    await runWithEvalContext({ identity: 'alice' }, async () => {
      expect(getAmbientEvalOverrides()?.identity).toBe('alice');
      await runWithEvalContext({ identity: 'bob' }, async () => {
        expect(getAmbientEvalOverrides()?.identity).toBe('bob');
      });
      expect(getAmbientEvalOverrides()?.identity).toBe('alice');
    });
    expect(getAmbientEvalOverrides()).toBeUndefined();
  });
});
