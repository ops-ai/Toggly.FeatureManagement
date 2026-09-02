import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'
import type { CacheProvider, FeatureDefinitions } from './types.js'
import { createLogger } from './utils.js'
import { CACHE_KEYS } from './constants.js'

/**
 * In-memory cache provider
 */
export class MemoryCacheProvider implements CacheProvider {
  private cache = new Map<string, { value: string; expires: number | null }>()

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    if (entry.expires !== null && Date.now() > entry.expires) {
      this.cache.delete(key)
      return null
    }

    return entry.value
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    this.cache.set(key, {
      value,
      expires: ttl ? Date.now() + ttl : null,
    })
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key)
    return value !== null
  }

  clear(): void {
    this.cache.clear()
  }
}

/**
 * File-based cache provider for offline/startup resilience
 */
export class FileCacheProvider implements CacheProvider {
  private basePath: string
  private logger: ReturnType<typeof createLogger>

  constructor(basePath: string, debug = false) {
    this.basePath = basePath
    this.logger = createLogger(debug)
  }

  private getFilePath(key: string): string {
    // Sanitize key to be a valid filename
    const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, '_')
    return `${this.basePath}/${safeKey}.json`
  }

  async get(key: string): Promise<string | null> {
    const filePath = this.getFilePath(key)

    try {
      const content = await readFile(filePath, 'utf-8')
      const data = JSON.parse(content)

      if (data.expires !== null && Date.now() > data.expires) {
        await this.delete(key)
        return null
      }

      return data.value
    } catch {
      return null
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const filePath = this.getFilePath(key)
    const data = {
      value,
      expires: ttl ? Date.now() + ttl : null,
      createdAt: Date.now(),
    }

    try {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (error) {
      this.logger.error('Failed to write cache file:', error)
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.getFilePath(key)

    try {
      await unlink(filePath)
    } catch {
      // File may not exist, ignore
    }
  }

  async has(key: string): Promise<boolean> {
    const filePath = this.getFilePath(key)

    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Definitions cache wrapper with serialization
 */
export class DefinitionsCache {
  private provider: CacheProvider
  private logger: ReturnType<typeof createLogger>

  constructor(provider: CacheProvider, debug = false) {
    this.provider = provider
    this.logger = createLogger(debug)
  }

  /**
   * Get cached feature-definition models (definitions-signed array).
   * Legacy boolean snapshots are ignored.
   */
  async getDefinitionModels(
    key: string
  ): Promise<FeatureDefinitionModel[] | null> {
    try {
      const value = await this.provider.get(key)

      if (!value) {
        return null
      }

      const parsed: unknown = JSON.parse(value)
      if (!Array.isArray(parsed)) {
        return null
      }
      return parsed as FeatureDefinitionModel[]
    } catch (error) {
      this.logger.error('Failed to parse cached definitions:', error)
      return null
    }
  }

  /**
   * Set cached feature-definition models
   */
  async setDefinitionModels(
    key: string,
    definitions: FeatureDefinitionModel[],
    ttl?: number
  ): Promise<void> {
    try {
      await this.provider.set(key, JSON.stringify(definitions), ttl)
    } catch (error) {
      this.logger.error('Failed to cache definitions:', error)
    }
  }

  /**
   * @deprecated Prefer getDefinitionModels — kept for boolean snapshot caches.
   */
  async getDefinitions(key: string): Promise<FeatureDefinitions | null> {
    try {
      const value = await this.provider.get(key)

      if (!value) {
        return null
      }

      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object') {
        return null
      }
      return parsed as FeatureDefinitions
    } catch (error) {
      this.logger.error('Failed to parse cached definitions:', error)
      return null
    }
  }

  /**
   * @deprecated Prefer setDefinitionModels
   */
  async setDefinitions(
    key: string,
    definitions: FeatureDefinitions,
    ttl?: number
  ): Promise<void> {
    try {
      await this.provider.set(key, JSON.stringify(definitions), ttl)
    } catch (error) {
      this.logger.error('Failed to cache definitions:', error)
    }
  }

  /**
   * Get cached ETag
   */
  async getEtag(key: string): Promise<string | null> {
    return this.provider.get(key)
  }

  /**
   * Set cached ETag
   */
  async setEtag(key: string, etag: string, ttl?: number): Promise<void> {
    return this.provider.set(key, etag, ttl)
  }

  /**
   * Get cached JWKS JSON
   */
  async getJwks(key: string): Promise<string | null> {
    return this.provider.get(key)
  }

  /**
   * Set cached JWKS JSON
   */
  async setJwks(key: string, value: string, ttl?: number): Promise<void> {
    return this.provider.set(key, value, ttl)
  }

  /**
   * Clear all cached data for a key
   */
  async clear(key: string): Promise<void> {
    await this.provider.delete(key)
  }

  /**
   * Clear definitions, ETag, and JWKS cache entries.
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.provider.delete(CACHE_KEYS.DEFINITIONS),
      this.provider.delete(CACHE_KEYS.ETAG),
      this.provider.delete(CACHE_KEYS.JWKS),
    ])
    if ('clear' in this.provider && typeof (this.provider as MemoryCacheProvider).clear === 'function') {
      ;(this.provider as MemoryCacheProvider).clear()
    }
  }
}

/**
 * Create a memory cache provider
 */
export function createMemoryCache(): MemoryCacheProvider {
  return new MemoryCacheProvider()
}

/**
 * Create a file cache provider
 */
export function createFileCache(basePath: string, debug = false): FileCacheProvider {
  return new FileCacheProvider(basePath, debug)
}
