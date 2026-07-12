import { StorageKeys } from '../lib/models/storage-keys';

describe('StorageKeys', () => {
  it('includes context suffix when contextKey is provided', () => {
    expect(StorageKeys.flagsCacheKey('app', 'Prod', 'ctx')).toBe('toggly:flags:app:Prod:ctx');
    expect(StorageKeys.variantsCacheKey('app', 'Prod', 'ctx')).toBe('toggly:variants:app:Prod:ctx');
  });

  it('exposes the cache LRU index key', () => {
    expect(StorageKeys.cacheLruKey).toBe('toggly:cache-lru');
  });
});
