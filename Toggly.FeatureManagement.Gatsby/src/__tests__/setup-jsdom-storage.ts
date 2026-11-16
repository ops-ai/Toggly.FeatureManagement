/**
 * Node 26 exposes an experimental `localStorage` global that is undefined
 * without `--localstorage-file`, which shadows jsdom's Storage and breaks
 * vitest specs that call `localStorage.clear()` / `getItem`.
 *
 * Point both `globalThis.localStorage` and `window.localStorage` at a working
 * in-memory Storage whenever the current binding is missing methods.
 */

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(String(key), String(value));
    },
  };
}

function ensureLocalStorage(): void {
  const current = globalThis.localStorage as Storage | undefined;
  if (current && typeof current.clear === 'function' && typeof current.getItem === 'function') {
    return;
  }
  const windowStorage = globalThis.window?.localStorage;
  const storage =
    windowStorage && typeof windowStorage.clear === 'function'
      ? windowStorage
      : createMemoryStorage();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    enumerable: true,
    value: storage,
    writable: true,
  });
  if (globalThis.window !== undefined) {
    Object.defineProperty(globalThis.window, 'localStorage', {
      configurable: true,
      enumerable: true,
      value: storage,
      writable: true,
    });
  }
}

ensureLocalStorage();
