// Node 25+ exposes a built-in localStorage that shadows happy-dom's Storage
// unless workers are started with --no-webstorage. Vitest 3 only forwards
// poolOptions.*.execArgv to workers; if that flag is missing or ignored,
// localStorage.clear() throws. Ensure a usable in-memory Storage either way.
class MemoryStorage implements Storage {
  #map = new Map<string, string>()
  get length() {
    return this.#map.size
  }
  clear() {
    this.#map.clear()
  }
  getItem(key: string) {
    return this.#map.has(key) ? this.#map.get(key)! : null
  }
  key(index: number) {
    return [...this.#map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.#map.delete(key)
  }
  setItem(key: string, value: string) {
    this.#map.set(String(key), String(value))
  }
}

function storageUsable(candidate: unknown): candidate is Storage {
  try {
    return !!candidate && typeof (candidate as Storage).clear === 'function'
  } catch {
    return false
  }
}

function ensureStorage(name: 'localStorage' | 'sessionStorage') {
  const current = (() => {
    try {
      return (globalThis as Record<string, unknown>)[name]
    } catch {
      return undefined
    }
  })()
  if (storageUsable(current)) return
  const memory = new MemoryStorage()
  Object.defineProperty(globalThis, name, { value: memory, configurable: true, writable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, { value: memory, configurable: true, writable: true })
  }
}

ensureStorage('localStorage')
ensureStorage('sessionStorage')
