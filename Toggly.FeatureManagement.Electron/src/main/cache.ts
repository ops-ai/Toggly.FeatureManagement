import { mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
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

/** Internal body validation shared with definitions loading. */
export function isValidDefinitions(value: unknown): value is EvaluatedDefinitions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(flag => {
    if (typeof flag === 'boolean') return true
    if (!flag || typeof flag !== 'object' || Array.isArray(flag)) return false
    const gate = flag as { requirement?: unknown; rules?: unknown }
    return (gate.requirement === 'all' || gate.requirement === 'any') && Array.isArray(gate.rules) && gate.rules.every(rule =>
      rule && typeof rule === 'object' && typeof rule.property === 'string' && typeof rule.op === 'string' && typeof rule.value === 'string' &&
      (rule.type === undefined || ['datetime', 'number', 'boolean', 'string', 'string[]'].includes(rule.type)))
  })
}

const pendingWrites = new Map<string, object>()

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
      const parsed = JSON.parse(raw) as DiskCacheEntry & { scope?: string[] }
      if (!parsed || typeof parsed !== 'object' || !isValidDefinitions(parsed.flags) || (parsed.revision != null && typeof parsed.revision !== 'string') || (parsed.scope !== undefined && JSON.stringify(parsed.scope) !== JSON.stringify([appKey, environment, contextKey]))) {
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
    const encoded = JSON.stringify({ ...entry, scope: [appKey, environment, contextKey] })
    const operation = {}
    pendingWrites.set(path, operation)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await mkdir(join(this.userDataPath, 'toggly'), { recursive: true })
      await writeFile(temporary, encoded, 'utf-8')
      if (pendingWrites.get(path) === operation) await rename(temporary, path)
    } finally {
      if (pendingWrites.get(path) === operation) pendingWrites.delete(path)
      try { await unlink(temporary) } catch { /* Renamed or never created. */ }
    }
  }

  async clear(appKey: string, environment: string, contextKey: string): Promise<void> {
    const path = this.filePath(appKey, environment, contextKey)
    pendingWrites.delete(path)
    try {
      await unlink(path)
    } catch {
      // ignore missing file
    }
  }
}
