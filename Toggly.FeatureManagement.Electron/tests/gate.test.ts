import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiskFeatureCache, buildCacheFilePath } from '../src/main/cache.js'

describe('DiskFeatureCache', () => {
  let userDataPath: string

  beforeEach(async () => {
    userDataPath = await mkdtemp(join(tmpdir(), 'toggly-cache-'))
  })

  afterEach(async () => {
    await rm(userDataPath, { recursive: true, force: true })
  })

  it('buildCacheFilePath sanitizes segments', () => {
    const path = buildCacheFilePath(userDataPath, 'app/key', 'Prod Env', 'ctx|1')
    expect(path).toContain(join(userDataPath, 'toggly'))
    expect(path).not.toContain('app/key')
  })

  it('writes and reads cache entries', async () => {
    const cache = new DiskFeatureCache(userDataPath)
    await cache.write('app', 'Production', 'ctx', {
      flags: { A: true },
      revision: 'rev-1',
      updatedAt: 123,
    })
    const entry = await cache.read('app', 'Production', 'ctx')
    expect(entry).toEqual({
      flags: { A: true },
      revision: 'rev-1',
      updatedAt: 123,
    })
  })

  it('returns null for missing files', async () => {
    const cache = new DiskFeatureCache(userDataPath)
    expect(await cache.read('app', 'Production', 'missing')).toBeNull()
  })

  it('returns null for corrupt JSON', async () => {
    const cache = new DiskFeatureCache(userDataPath)
    const path = buildCacheFilePath(userDataPath, 'app', 'Production', 'bad')
    await mkdir(join(userDataPath, 'toggly'), { recursive: true })
    await writeFile(path, '{not-json', 'utf-8')
    expect(await cache.read('app', 'Production', 'bad')).toBeNull()
  })

  it('returns null for invalid payload shape', async () => {
    const cache = new DiskFeatureCache(userDataPath)
    const path = buildCacheFilePath(userDataPath, 'app', 'Production', 'shape')
    await mkdir(join(userDataPath, 'toggly'), { recursive: true })
    await writeFile(path, JSON.stringify({ revision: 'x' }), 'utf-8')
    expect(await cache.read('app', 'Production', 'shape')).toBeNull()
  })

  it('clears cache files', async () => {
    const cache = new DiskFeatureCache(userDataPath)
    await cache.write('app', 'Production', 'ctx', {
      flags: { A: true },
      revision: null,
      updatedAt: Date.now(),
    })
    await cache.clear('app', 'Production', 'ctx')
    expect(await cache.read('app', 'Production', 'ctx')).toBeNull()
    await cache.clear('app', 'Production', 'ctx')
  })
})
