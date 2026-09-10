import { expect, it, vi } from 'vitest'
const kit = vi.hoisted(() => ({ addPlugin: vi.fn(), addImports: vi.fn(), addComponent: vi.fn(), addServerPlugin: vi.fn(), addTemplate: vi.fn() }))
vi.mock('@nuxt/kit', () => ({ ...kit, defineNuxtModule: (value: unknown) => value, createResolver: () => ({ resolve: (s: string) => s }) }))
import module from '../src/module/module'
it.each([true, false])('registers module options and callback template, enabled=%s', enabled => {
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  kit.addTemplate.mockImplementation(template => { expect(template.getContents()).toContain('export default'); return { dst: '/virtual/error.mjs' } })
  const options = { appKey: enabled ? 'app' : undefined, ssr: enabled, autoImport: enabled, globalComponents: enabled, debug: true, onError: enabled ? () => {} : undefined, groups: ['beta'], claims: { plan: 'pro' } }
  const nuxt = { options: { alias: {}, runtimeConfig: { public: {} }, nitro: enabled ? {} : undefined } }
  ;(module as any).setup(options, nuxt)
  expect((nuxt.options.runtimeConfig.public as any).toggly).toEqual(expect.objectContaining({ groups: ['beta'], claims: { plan: 'pro' } }))
  expect((nuxt.options.runtimeConfig.public as any).toggly.onError).toBeUndefined()
  expect(kit.addServerPlugin).toHaveBeenCalledTimes(enabled ? 1 : 0)
  expect(kit.addComponent).toHaveBeenCalledTimes(enabled ? 3 : 0)
  vi.restoreAllMocks()
})

it('exports the module and shared public helpers through its package entry', async () => {
  const entry = await import('../src/module')
  expect(entry.default).toBe(module)
  expect(entry.createTogglyClient).toBeTypeOf('function')
  expect(Object.keys(await import('../src/module/types'))).toEqual([])
})
