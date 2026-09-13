import { beforeEach, describe, expect, it, vi } from 'vitest'

const exposeToggly = vi.fn()

vi.mock('../src/preload/index.js', () => ({ exposeToggly }))

describe('compiled preload entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('exposes the renderer bridge when Electron evaluates the preload entry', async () => {
    await import('../src/preload/entry.js')

    expect(exposeToggly).toHaveBeenCalledOnce()
  })
})
