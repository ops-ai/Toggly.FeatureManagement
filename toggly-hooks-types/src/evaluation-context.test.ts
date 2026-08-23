import { describe, it, expect } from 'vitest';
import {
  appendEvaluationContext,
  buildEvaluatedSignedUrl,
  evaluationContextCacheKey,
  MAX_EVALUATION_CLAIMS,
  normalizeEvaluationClaims,
  type TogglyEvaluationContext,
} from './evaluation-context';

describe('appendEvaluationContext', () => {
  it('appends identity as u for evaluated mode', () => {
    const url = new URL('https://definitions.toggly.io/evaluated-signed/app/Production');
    appendEvaluationContext(url, { identity: 'user-1' }, 'evaluated');
    expect(url.searchParams.get('u')).toBe('user-1');
    expect(url.searchParams.get('userId')).toBeNull();
  });

  it('appends identity as userId for variants mode', () => {
    const url = new URL('https://definitions.toggly.io/evaluated-variants-signed/app/Production');
    appendEvaluationContext(url, { identity: 'user-1' }, 'variants');
    expect(url.searchParams.get('userId')).toBe('user-1');
    expect(url.searchParams.get('u')).toBeNull();
  });

  it('appends repeatable g params for groups', () => {
    const url = new URL('https://definitions.toggly.io/evaluated-signed/app/Production');
    appendEvaluationContext(url, { groups: ['beta', 'enterprise'] }, 'evaluated');
    expect(url.searchParams.getAll('g')).toEqual(['beta', 'enterprise']);
  });

  it('appends claim.{type} params for claims', () => {
    const url = new URL('https://definitions.toggly.io/evaluated-signed/app/Production');
    appendEvaluationContext(
      url,
      { claims: { role: 'admin', plan: 'premium' } },
      'evaluated',
    );
    expect(url.searchParams.get('claim.role')).toBe('admin');
    expect(url.searchParams.get('claim.plan')).toBe('premium');
  });

  it('ignores empty groups and claims', () => {
    const url = new URL('https://definitions.toggly.io/evaluated-signed/app/Production');
    appendEvaluationContext(url, { groups: [], claims: {} }, 'evaluated');
    expect(url.search).toBe('');
  });

  it(`appends at most ${MAX_EVALUATION_CLAIMS} claim params`, () => {
    const claims: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      claims[`claim${String(i).padStart(2, '0')}`] = 'v';
    }
    const url = new URL('https://definitions.toggly.io/evaluated-signed/app/Production');
    appendEvaluationContext(url, { claims }, 'evaluated');
    const claimParams = [...url.searchParams.keys()].filter(k => k.startsWith('claim.'));
    expect(claimParams).toHaveLength(MAX_EVALUATION_CLAIMS);
    expect(url.searchParams.get('claim.claim00')).toBe('v');
    expect(url.searchParams.get('claim.claim20')).toBeNull();
  });
});

describe('normalizeEvaluationClaims', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeEvaluationClaims(undefined)).toBeUndefined();
    expect(normalizeEvaluationClaims({})).toBeUndefined();
  });

  it(`limits to ${MAX_EVALUATION_CLAIMS} entries`, () => {
    const claims: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      claims[`k${String(i).padStart(2, '0')}`] = 'v';
    }
    const normalized = normalizeEvaluationClaims(claims);
    expect(Object.keys(normalized ?? {})).toHaveLength(MAX_EVALUATION_CLAIMS);
  });
});

describe('evaluationContextCacheKey', () => {
  it('returns empty string for undefined context', () => {
    expect(evaluationContextCacheKey(undefined)).toBe('');
  });

  it('builds stable key for identity, groups, and claims', () => {
    const ctx: TogglyEvaluationContext = {
      identity: 'user-1',
      groups: ['beta', 'alpha'],
      claims: { plan: 'premium', role: 'admin' },
    };
    expect(evaluationContextCacheKey(ctx)).toBe(
      'u:user-1|g:alpha,beta|c:plan=premium&role=admin',
    );
  });

  it('sorts groups and claim keys for stable cache keys', () => {
    const a = evaluationContextCacheKey({
      groups: ['z', 'a'],
      claims: { z: '1', a: '2' },
    });
    const b = evaluationContextCacheKey({
      groups: ['a', 'z'],
      claims: { a: '2', z: '1' },
    });
    expect(a).toBe(b);
  });
});

describe('buildEvaluatedSignedUrl', () => {
  it('builds an evaluated URL with identity as u', () => {
    const url = buildEvaluatedSignedUrl(
      'https://definitions.toggly.io/',
      'app',
      'Production',
      { identity: 'user-1' },
      false,
    );
    expect(url).toBe(
      'https://definitions.toggly.io/evaluated-signed/app/Production?u=user-1',
    );
  });

  it('builds a variants URL with identity as userId', () => {
    const url = buildEvaluatedSignedUrl(
      'https://definitions.toggly.io',
      'app',
      'Production',
      { identity: 'user-1' },
      true,
    );
    expect(url).toBe(
      'https://definitions.toggly.io/evaluated-variants-signed/app/Production?userId=user-1',
    );
  });
});
