import type { TogglyStorage } from '@ops-ai/react-native-toggly-core';
import { MMKV } from 'react-native-mmkv';

/**
 * Options for MMKVStorageAdapter
 */
export interface MMKVStorageAdapterOptions {
  /**
   * MMKV instance ID
   * @default 'toggly'
   */
  id?: string;

  /**
   * Prefix for all storage keys
   * @default 'toggly:'
   */
  keyPrefix?: string;

  /**
   * Enable encryption
   * Requires setting encryptionKey
   */
  encrypted?: boolean;

  /**
   * Encryption key for encrypted storage
   * Must be provided if encrypted is true
   */
  encryptionKey?: string;

  /**
   * Custom storage path
   * Only works on Android
   */
  path?: string;
}

/**
 * MMKV storage adapter for Toggly SDK.
 * Provides high-performance persistent feature flag storage using react-native-mmkv.
 *
 * MMKV is ~30x faster than AsyncStorage for most operations, making it ideal
 * for feature flag storage where quick reads are important.
 *
 * @example
 * ```tsx
 * import { createMMKVStorageAdapter } from '@ops-ai/react-native-toggly-storage-mmkv';
 *
 * const storage = createMMKVStorageAdapter();
 *
 * <TogglyProvider
 *   appKey="your-app-key"
 *   storage={storage}
 * >
 *   <App />
 * </TogglyProvider>
 * ```
 *
 * @example
 * // With encryption
 * ```tsx
 * const storage = createMMKVStorageAdapter({
 *   encrypted: true,
 *   encryptionKey: 'your-secure-key',
 * });
 * ```
 */
export class MMKVStorageAdapter implements TogglyStorage {
  private mmkv: MMKV;
  private keyPrefix: string;

  constructor(options: MMKVStorageAdapterOptions = {}) {
    const {
      id = 'toggly',
      keyPrefix = 'toggly:',
      encrypted = false,
      encryptionKey,
      path,
    } = options;

    this.keyPrefix = keyPrefix;

    // Configure MMKV instance
    const mmkvOptions: {
      id: string;
      encryptionKey?: string;
      path?: string;
    } = { id };

    if (encrypted) {
      if (!encryptionKey) {
        throw new Error(
          '[Toggly] encryptionKey is required when encrypted is true'
        );
      }
      mmkvOptions.encryptionKey = encryptionKey;
    }

    if (path) {
      mmkvOptions.path = path;
    }

    this.mmkv = new MMKV(mmkvOptions);
  }

  /**
   * Get the full storage key with prefix
   */
  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Get a value from storage
   * @param key Storage key
   * @returns The stored value or null if not found
   */
  async get(key: string): Promise<string | null> {
    try {
      const value = this.mmkv.getString(this.getKey(key));
      return value ?? null;
    } catch (error) {
      console.error('[Toggly] MMKV get error:', error);
      throw error;
    }
  }

  /**
   * Set a value in storage
   * @param key Storage key
   * @param value Value to store
   */
  async set(key: string, value: string): Promise<void> {
    try {
      this.mmkv.set(this.getKey(key), value);
    } catch (error) {
      console.error('[Toggly] MMKV set error:', error);
      throw error;
    }
  }

  /**
   * Delete a value from storage
   * @param key Storage key
   */
  async delete(key: string): Promise<void> {
    try {
      this.mmkv.delete(this.getKey(key));
    } catch (error) {
      console.error('[Toggly] MMKV delete error:', error);
      throw error;
    }
  }

  /**
   * Clear all Toggly-related items from storage
   */
  async clear(): Promise<void> {
    try {
      const allKeys = this.mmkv.getAllKeys();
      const togglyKeys = allKeys.filter((key) => key.startsWith(this.keyPrefix));
      togglyKeys.forEach((key) => this.mmkv.delete(key));
    } catch (error) {
      console.error('[Toggly] MMKV clear error:', error);
      throw error;
    }
  }

  /**
   * Get all Toggly-related keys from storage
   */
  async keys(): Promise<string[]> {
    try {
      const allKeys = this.mmkv.getAllKeys();
      return allKeys
        .filter((key) => key.startsWith(this.keyPrefix))
        .map((key) => key.substring(this.keyPrefix.length));
    } catch (error) {
      console.error('[Toggly] MMKV keys error:', error);
      throw error;
    }
  }

  /**
   * Check if storage contains a specific key
   */
  contains(key: string): boolean {
    return this.mmkv.contains(this.getKey(key));
  }

  /**
   * Get the underlying MMKV instance for advanced usage
   */
  getMMKVInstance(): MMKV {
    return this.mmkv;
  }
}

/**
 * Create an MMKV storage adapter for Toggly SDK
 *
 * @param options Adapter options
 * @returns MMKVStorageAdapter instance
 *
 * @example
 * ```tsx
 * import { createMMKVStorageAdapter } from '@ops-ai/react-native-toggly-storage-mmkv';
 *
 * // Basic usage
 * const storage = createMMKVStorageAdapter();
 *
 * // With custom options
 * const storage = createMMKVStorageAdapter({
 *   id: 'myapp-toggly',
 *   keyPrefix: 'myapp:toggly:',
 * });
 *
 * // With encryption
 * const storage = createMMKVStorageAdapter({
 *   encrypted: true,
 *   encryptionKey: 'your-256-bit-encryption-key',
 * });
 *
 * <TogglyProvider
 *   appKey="your-app-key"
 *   storage={storage}
 * >
 *   <App />
 * </TogglyProvider>
 * ```
 */
export function createMMKVStorageAdapter(
  options?: MMKVStorageAdapterOptions
): MMKVStorageAdapter {
  return new MMKVStorageAdapter(options);
}
