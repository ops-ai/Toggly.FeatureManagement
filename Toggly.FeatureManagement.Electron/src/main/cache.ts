import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvaluatedDefinitions } from '@ops-ai/toggly-hooks-types'

export interface DiskCacheEntry {
  flags: EvaluatedDefinitions
  revision: string | null
  updatedAt: number
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function buildCacheFilePath(
  userDataPath: string,
  appKey: string,
  environment: string,
  contextKey: string,
): string {
  const dir = join(userDataPath, 'toggly')
  const name = `flags-${sanitizeSegment(appKey)}-${sanitizeSegment(environment)}-${sanitizeSegment(contextKey)}.json`
  return join(dir, name)
}

export class DiskFeatureCache {
  constructor(private readonly userDataPath: string) {}

  private filePath(appKey: string, environment: string, contextKey: string): string {
    return buildCacheFilePath(this.userDataPath, appKey, environment, contextKey)
  }

  async read(
    appKey: string,
    environment: string,
    contextKey: string,
  ): Promise<DiskCacheEntry | null> {
    const path = this.filePath(appKey, environment, contextKey)
    try {
      const raw = await readFile(path, 'utf-8')
      const parsed = JSON.parse(raw) as DiskCacheEntry
      if (!parsed || typeof parsed !== 'object' || !parsed.flags || typeof parsed.flags !== 'object') {
        return null
      }
      return {
        flags: parsed.flags,
        revision: parsed.revision ?? null,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      }
    } catch {
      return null
    }
  }

  async write(
    appKey: string,
    environment: string,
    contextKey: string,
    entry: DiskCacheEntry,
  ): Promise<void> {
    const path = this.filePath(appKey, environment, contextKey)
    await mkdir(join(this.userDataPath, 'toggly'), { recursive: true })
    await writeFile(path, JSON.stringify(entry), 'utf-8')
  }

  async clear(appKey: string, environment: string, contextKey: string): Promise<void> {
    const path = this.filePath(appKey, environment, contextKey)
    try {
      await unlink(path)
    } catch {
      // ignore missing file
    }
  }
}
