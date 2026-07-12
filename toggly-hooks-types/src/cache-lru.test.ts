import { describe, expect, it } from 'vitest';
import {
  emptyCacheLruIndex,
  isCacheLruEnabled,
  parseCacheLruIndex,
  removeCacheLruKeys,
  selectCacheLruKeysToEvict,
  serializeCacheLruIndex,
  touchCacheLruKey,
} from './cache-lru';

describe('parseCacheLruIndex', () => {
  it('treats corrupt JSON as empty', () => {
    expect(parseCacheLruIndex('not-json')).toEqual(emptyCacheLruIndex());
  });

  it('treats null and undefined as empty', () => {
    expect(parseCacheLruIndex(null)).toEqual(emptyCacheLruIndex());
    expect(parseCacheLruIndex(undefined)).toEqual(emptyCacheLruIndex());
  });

  it('treats missing or invalid entries as empty', () => {
    expect(parseCacheLruIndex('{}')).toEqual(emptyCacheLruIndex());
    expect(parseCacheLruIndex('{"entries":null}')).toEqual(emptyCacheLruIndex());
  });

  it('drops entries with non-numeric lastAccessed', () => {
    expect(
      parseCacheLruIndex('{"entries":{"a":{"lastAccessed":"x"},"b":{"lastAccessed":2}}}'),
    ).toEqual({ entries: { b: { lastAccessed: 2 } } });
  });

  it('parses valid serialized index', () => {
    const index = touchCacheLruKey(emptyCacheLruIndex(), 'a', 1);
    const parsed = parseCacheLruIndex(serializeCacheLruIndex(index));
    expect(parsed).toEqual(index);
  });
});

describe('touchCacheLruKey', () => {
  it('touches keys and selects oldest for eviction', () => {
    let index = emptyCacheLruIndex();
    index = touchCacheLruKey(index, 'a', 1);
    index = touchCacheLruKey(index, 'b', 2);
    index = touchCacheLruKey(index, 'c', 3);
    expect(selectCacheLruKeysToEvict(index, 2)).toEqual(['a']);
    index = touchCacheLruKey(index, 'a', 4);
    expect(selectCacheLruKeysToEvict(index, 2, { protectKey: 'c' })).toEqual(['b']);
  });

  it('tie-breaks by localeCompare when lastAccessed is equal', () => {
    let index = emptyCacheLruIndex();
    index = touchCacheLruKey(index, 'b', 1);
    index = touchCacheLruKey(index, 'a', 1);
    expect(selectCacheLruKeysToEvict(index, 1)).toEqual(['a']);
  });
});

describe('removeCacheLruKeys', () => {
  it('drops entries', () => {
    let index = touchCacheLruKey(emptyCacheLruIndex(), 'a', 1);
    index = removeCacheLruKeys(index, ['a']);
    expect(index.entries.a).toBeUndefined();
  });

  it('leaves other entries intact', () => {
    let index = touchCacheLruKey(emptyCacheLruIndex(), 'a', 1);
    index = touchCacheLruKey(index, 'b', 2);
    index = removeCacheLruKeys(index, ['a']);
    expect(index.entries.b).toEqual({ lastAccessed: 2 });
  });
});

describe('selectCacheLruKeysToEvict', () => {
  it('returns empty when maxKeys is not positive or finite', () => {
    const index = touchCacheLruKey(emptyCacheLruIndex(), 'a', 1);
    expect(selectCacheLruKeysToEvict(index, 0)).toEqual([]);
    expect(selectCacheLruKeysToEvict(index, -1)).toEqual([]);
    expect(selectCacheLruKeysToEvict(index, Number.NaN)).toEqual([]);
    expect(selectCacheLruKeysToEvict(index, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('floors fractional maxKeys', () => {
    let index = emptyCacheLruIndex();
    index = touchCacheLruKey(index, 'a', 1);
    index = touchCacheLruKey(index, 'b', 2);
    index = touchCacheLruKey(index, 'c', 3);
    expect(selectCacheLruKeysToEvict(index, 2.9)).toEqual(['a']);
  });

  it('returns empty when entries fit within maxKeys', () => {
    let index = emptyCacheLruIndex();
    index = touchCacheLruKey(index, 'a', 1);
    index = touchCacheLruKey(index, 'b', 2);
    expect(selectCacheLruKeysToEvict(index, 2)).toEqual([]);
    expect(selectCacheLruKeysToEvict(index, 3)).toEqual([]);
  });

  it('skips protectKey when selecting', () => {
    let index = emptyCacheLruIndex();
    index = touchCacheLruKey(index, 'a', 1);
    index = touchCacheLruKey(index, 'b', 2);
    index = touchCacheLruKey(index, 'c', 3);
    expect(selectCacheLruKeysToEvict(index, 1, { protectKey: 'a' })).toEqual(['b', 'c']);
  });

  it('skips all protectKeys so sibling flags/variants survive', () => {
    let index = emptyCacheLruIndex();
    index = touchCacheLruKey(index, 'flags:old', 1);
    index = touchCacheLruKey(index, 'flags:a', 2);
    index = touchCacheLruKey(index, 'variants:a', 3);
    expect(
      selectCacheLruKeysToEvict(index, 2, {
        protectKeys: ['flags:a', 'variants:a'],
      }),
    ).toEqual(['flags:old']);
  });
});

describe('isCacheLruEnabled', () => {
  it('returns false for null, 0, and -1', () => {
    expect(isCacheLruEnabled(null)).toBe(false);
    expect(isCacheLruEnabled(0)).toBe(false);
    expect(isCacheLruEnabled(-1)).toBe(false);
  });

  it('returns true for positive finite numbers', () => {
    expect(isCacheLruEnabled(5)).toBe(true);
  });

  it('returns false for undefined and non-finite numbers', () => {
    expect(isCacheLruEnabled(undefined)).toBe(false);
    expect(isCacheLruEnabled(Number.NaN)).toBe(false);
    expect(isCacheLruEnabled(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
