import type { TogglyStorage } from '@ops-ai/react-native-toggly-core';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Options for an MMKV 4 storage adapter.
 *
 * The default ID and key prefix intentionally match the MMKV 2/3 adapter so
 * existing Toggly values keep the same addresses after a native migration.
 */
export interface MMKV4StorageAdapterOptions {
  /** MMKV instance ID. Defaults to `toggly`. */
  id?: string;

  /** Prefix for Toggly keys. Defaults to `toggly:`. */
  keyPrefix?: string;

  /** Enable MMKV encryption. Requires `encryptionKey`. */
  encrypted?: boolean;

  /** Encryption key used to create the MMKV instance. */
  encryptionKey?: string;

  /** Custom MMKV path. */
  path?: string;

  /**
   * An existing MMKV 4 instance. Configure ID, path, and encryption on that
   * instance when migrating an existing native store.
   */
  mmkv?: MMKV;
}

/** MMKV 4/Nitro storage adapter for the React Native Toggly SDK. */
export class MMKV4StorageAdapter implements TogglyStorage {
  private readonly mmkv: MMKV;
  private readonly keyPrefix: string;

  constructor(options: MMKV4StorageAdapterOptions = {}) {
    const {
      id = 'toggly',
      keyPrefix = 'toggly:',
      encrypted = false,
      encryptionKey,
      path,
      mmkv,
    } = options;

    this.keyPrefix = keyPrefix;

    if (mmkv) {
      this.mmkv = mmkv;
      return;
    }

    if (encrypted && !encryptionKey) {
      throw new Error('[Toggly] encryptionKey is required when encrypted is true');
    }

    this.mmkv = createMMKV({
      id,
      ...(encrypted ? { encryptionKey } : {}),
      ...(path ? { path } : {}),
    });
  }

  async get(key: string): Promise<string | null> {
    try {
      return this.mmkv.getString(this.getKey(key)) ?? null;
    } catch (error) {
      console.error('[Toggly] MMKV 4 get error:', error);
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      this.mmkv.set(this.getKey(key), value);
    } catch (error) {
      console.error('[Toggly] MMKV 4 set error:', error);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      this.mmkv.remove(this.getKey(key));
    } catch (error) {
      console.error('[Toggly] MMKV 4 delete error:', error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      this.mmkv
        .getAllKeys()
        .filter((key) => key.startsWith(this.keyPrefix))
        .forEach((key) => this.mmkv.remove(key));
    } catch (error) {
      console.error('[Toggly] MMKV 4 clear error:', error);
      throw error;
    }
  }

  async keys(): Promise<string[]> {
    try {
      return this.mmkv
        .getAllKeys()
        .filter((key) => key.startsWith(this.keyPrefix))
        .map((key) => key.slice(this.keyPrefix.length));
    } catch (error) {
      console.error('[Toggly] MMKV 4 keys error:', error);
      throw error;
    }
  }

  contains(key: string): boolean {
    return this.mmkv.contains(this.getKey(key));
  }

  /** Return the MMKV 4 instance used by this adapter. */
  getMMKVInstance(): MMKV {
    return this.mmkv;
  }

  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}

/** Create an MMKV 4/Nitro Toggly storage adapter. */
export function createMMKV4StorageAdapter(
  options?: MMKV4StorageAdapterOptions
): MMKV4StorageAdapter {
  return new MMKV4StorageAdapter(options);
}
