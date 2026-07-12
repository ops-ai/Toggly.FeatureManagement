export interface CacheLruEntry {
  lastAccessed: number;
}

export interface CacheLruIndex {
  entries: Record<string, CacheLruEntry>;
}

export function emptyCacheLruIndex(): CacheLruIndex {
  return { entries: {} };
}

export function parseCacheLruIndex(raw: string | null | undefined): CacheLruIndex {
  if (!raw) {
    return emptyCacheLruIndex();
  }

  try {
    const parsed = JSON.parse(raw) as CacheLruIndex;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || !parsed.entries) {
      return emptyCacheLruIndex();
    }

    const entries: Record<string, CacheLruEntry> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const lastAccessed = (value as CacheLruEntry).lastAccessed;
      if (typeof lastAccessed === 'number' && Number.isFinite(lastAccessed)) {
        entries[key] = { lastAccessed };
      }
    }
    return { entries };
  } catch {
    return emptyCacheLruIndex();
  }
}

export function serializeCacheLruIndex(index: CacheLruIndex): string {
  return JSON.stringify({ entries: index.entries });
}

export function touchCacheLruKey(
  index: CacheLruIndex,
  key: string,
  now: number = Date.now(),
): CacheLruIndex {
  return {
    entries: {
      ...index.entries,
      [key]: { lastAccessed: now },
    },
  };
}

export function removeCacheLruKeys(index: CacheLruIndex, keys: string[]): CacheLruIndex {
  const entries = { ...index.entries };
  for (const key of keys) {
    delete entries[key];
  }
  return { entries };
}

function protectedKeySet(options?: {
  protectKey?: string;
  protectKeys?: string[];
}): Set<string> {
  const keys = new Set<string>();
  if (options?.protectKey) {
    keys.add(options.protectKey);
  }
  if (options?.protectKeys) {
    for (const key of options.protectKeys) {
      if (key) {
        keys.add(key);
      }
    }
  }
  return keys;
}

/**
 * Oldest keys to remove so the index length is at most `maxKeys`.
 *
 * Skips keys in `protectKeys` / `protectKey` (typically the key(s) just written
 * for the same evaluation context — e.g. flags + variants siblings).
 */
export function selectCacheLruKeysToEvict(
  index: CacheLruIndex,
  maxKeys: number,
  options?: { protectKey?: string; protectKeys?: string[] },
): string[] {
  if (!Number.isFinite(maxKeys) || maxKeys <= 0) {
    return [];
  }

  const limit = Math.floor(maxKeys);
  if (limit <= 0) {
    return [];
  }

  const keys = Object.keys(index.entries);
  const over = keys.length - limit;
  if (over <= 0) {
    return [];
  }

  const protectedKeys = protectedKeySet(options);
  const sorted = keys
    .slice()
    .sort((a, b) => (index.entries[a].lastAccessed - index.entries[b].lastAccessed) || a.localeCompare(b));

  const toEvict: string[] = [];
  for (const key of sorted) {
    if (toEvict.length >= over) {
      break;
    }
    if (protectedKeys.has(key)) {
      continue;
    }
    toEvict.push(key);
  }

  return toEvict;
}

/** True when a positive finite max is configured. */
export function isCacheLruEnabled(maxCacheKeys: number | null | undefined): boolean {
  return typeof maxCacheKeys === 'number' && Number.isFinite(maxCacheKeys) && maxCacheKeys > 0;
}
