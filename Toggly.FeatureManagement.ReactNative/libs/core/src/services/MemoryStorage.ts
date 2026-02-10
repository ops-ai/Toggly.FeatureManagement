import type { TogglyStorage } from '../models';

/**
 * In-memory storage implementation.
 * Used as a fallback when no storage provider is configured.
 * Data is lost when the app is closed.
 */
export class MemoryStorage implements TogglyStorage {
  private storage: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Get all keys in storage
   */
  keys(): string[] {
    return Array.from(this.storage.keys());
  }
}
