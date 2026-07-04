import type { TogglyStorage } from '@ops-ai/react-native-toggly-core';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Options for AsyncStorageAdapter
 */
export interface AsyncStorageAdapterOptions {
  /**
   * Prefix for all storage keys
   * @default '@toggly:'
   */
  keyPrefix?: string;
}

/**
 * AsyncStorage adapter for Toggly SDK.
 * Provides persistent feature flag storage using @react-native-async-storage/async-storage.
 *
 * @example
 * ```tsx
 * import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async';
 *
 * const storage = createAsyncStorageAdapter();
 *
 * <TogglyProvider
 *   appKey="your-app-key"
 *   storage={storage}
 * >
 *   <App />
 * </TogglyProvider>
 * ```
 */
export class AsyncStorageAdapter implements TogglyStorage {
  private keyPrefix: string;

  constructor(options: AsyncStorageAdapterOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? '@toggly:';
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
      return await AsyncStorage.getItem(this.getKey(key));
    } catch (error) {
      console.error('[Toggly] AsyncStorage get error:', error);
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
      await AsyncStorage.setItem(this.getKey(key), value);
    } catch (error) {
      console.error('[Toggly] AsyncStorage set error:', error);
      throw error;
    }
  }

  /**
   * Delete a value from storage
   * @param key Storage key
   */
  async delete(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(this.getKey(key));
    } catch (error) {
      console.error('[Toggly] AsyncStorage delete error:', error);
      throw error;
    }
  }

  /**
   * Clear all Toggly-related items from storage
   */
  async clear(): Promise<void> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const togglyKeys = allKeys.filter((key) => key.startsWith(this.keyPrefix));
      await AsyncStorage.multiRemove(togglyKeys);
    } catch (error) {
      console.error('[Toggly] AsyncStorage clear error:', error);
      throw error;
    }
  }

  /**
   * Get all Toggly-related keys from storage
   */
  async keys(): Promise<string[]> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      return allKeys
        .filter((key) => key.startsWith(this.keyPrefix))
        .map((key) => key.substring(this.keyPrefix.length));
    } catch (error) {
      console.error('[Toggly] AsyncStorage keys error:', error);
      throw error;
    }
  }
}

/**
 * Create an AsyncStorage adapter for Toggly SDK
 *
 * @param options Adapter options
 * @returns AsyncStorageAdapter instance
 *
 * @example
 * ```tsx
 * import { createAsyncStorageAdapter } from '@ops-ai/react-native-toggly-storage-async';
 *
 * const storage = createAsyncStorageAdapter({
 *   keyPrefix: '@myapp:toggly:',
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
export function createAsyncStorageAdapter(
  options?: AsyncStorageAdapterOptions
): AsyncStorageAdapter {
  return new AsyncStorageAdapter(options);
}
