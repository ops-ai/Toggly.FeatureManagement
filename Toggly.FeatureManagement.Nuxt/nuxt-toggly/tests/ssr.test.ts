import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, it, vi } from 'vitest'
import { Feature, useToggly, getTogglyClient } from '@ops-ai/nuxt-toggly-client'

const state = vi.hoisted(() => ({ config: { featureDefaults: { Enabled: true, Disabled: false }, enableLiveUpdates: false, refreshInterval: 0 } }))
vi.mock('#app', () => ({ defineNuxtPlugin: (fn: unknown) => fn, useRuntimeConfig: () => ({ public: { toggly: state.config } }) }))
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ public: { toggly: state.config } }) }))
vi.mock('#toggly/on-error', () => ({ default: undefined }))
import clientPlugin from '../src/runtime/plugin.client'

it('provides the instance consumed by composables and renders hydrated gates before network initialization', async () => {
  const vueApp = createSSRApp({ setup() { const t = useToggly(); return () => h('main', [h('b', String(t.features.value.Enabled)), h(Feature, { featureKey: 'Enabled' }, () => 'enabled-gate')]) } })
  await (clientPlugin as any)({ vueApp, payload: { toggly: { features: { Enabled: true, Disabled: false } } }, hook: vi.fn() })
  const html = await renderToString(vueApp)
  expect(html).toContain('<b>true</b>')
  expect(html).toContain('enabled-gate')
})

it('does not expose a request-created instance through the process global client', async () => {
  const vueApp = createSSRApp({ render: () => '' })
  await (clientPlugin as any)({ vueApp, payload: { toggly: { features: { Enabled: true, Disabled: false } } }, hook: vi.fn() })
  expect(getTogglyClient()).toBeNull()
})

it('renders concurrent request snapshots without exposing raw targeting definitions or retaining request clients', async () => {
  const { initServerToggly, resetServerToggly } = await import('@ops-ai/nuxt-toggly-server')
  const server = await initServerToggly({ featureDefaults: {}, enableLiveUpdates: false, enableUsageTracking: false, enableMetrics: false })
  const initialIdentity = server.identity
  server.hydrateDefinitions([{ featureKey: 'Targeted', filters: [{ name: 'Targeting', parameters: { 'Audience.Users:0': 'alice', 'Audience.DefaultRolloutPercentage': 0 } }] }])
  const plugin = (await import('../src/runtime/plugin.ssr')).default as any
  const { createServerSnapshot } = await import('../src/runtime/server-snapshot')
  const render = async (identity: string) => {
    const vueApp = createSSRApp({ setup() { const t = useToggly(); return () => h('b', String(t.features.value.Targeted)) } })
    const event = { context: { togglyEvalContext: { identity }, togglySsrSnapshot: () => createServerSnapshot(event as any, state.config) } }
    const app = { vueApp, payload: {} as any, ssrContext: { event }, hook: vi.fn() }
    await plugin(app)
    return { html: await renderToString(vueApp), payload: app.payload }
  }
  try {
    const [alice, bob] = await Promise.all([render('alice'), render('bob')])
    expect(alice.html).toBe('<b>true</b>')
    expect(bob.html).toBe('<b>false</b>')
    expect(alice.payload.toggly).toEqual({ features: { Enabled: true, Disabled: false, Targeted: true }, identity: 'alice' })
    expect(JSON.stringify(bob.payload)).not.toContain('Audience')
    expect(server.identity).toBe(initialIdentity)
    expect(getTogglyClient()).toBeNull()
  } finally { resetServerToggly() }
})

it('uses public defaults when server fetching is disabled and never calls a request snapshot provider', async () => {
  const plugin = (await import('../src/runtime/plugin.ssr')).default as any
  const original = state.config
  state.config = { ...original, ssr: false, globalDirectives: false } as any
  const snapshot = vi.fn(() => { throw new Error('must not fetch') })
  const hooks: Record<string, () => unknown> = {}
  const vueApp = createSSRApp({ setup() { const t = useToggly(); return () => h('b', String(t.features.value.Enabled)) } })
  const directive = vi.spyOn(vueApp, 'directive')
  try {
    const result = await plugin({ vueApp, payload: {}, ssrContext: { event: { context: { togglySsrSnapshot: snapshot } } }, hook: (name: string, fn: () => unknown) => { hooks[name] = fn } })
    expect(await renderToString(vueApp)).toBe('<b>true</b>')
    expect(snapshot).not.toHaveBeenCalled()
    expect(directive).not.toHaveBeenCalled()
    const destroy = vi.spyOn(result.provide.toggly.client, 'destroy')
    hooks['app:rendered']()
    expect(destroy).toHaveBeenCalledOnce()
  } finally { state.config = original }
})

it('does not reuse a hydrated users flags as defaults for a later identity', async () => {
  const vueApp = createSSRApp({ render: () => '' })
  const result = await (clientPlugin as any)({ vueApp, payload: { toggly: { features: { Enabled: true, Targeted: true }, identity: 'alice' } }, hook: vi.fn() })
  const toggly = result.provide.toggly
  expect(await toggly.client.isFeatureOn('Targeted')).toBe(true)
  expect(toggly.features.value.Targeted).toBe(true)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
  try {
    await toggly.init({ appKey: 'fixture', identity: 'bob', enableLiveUpdates: false, refreshInterval: 0 })
    expect(await toggly.isFeatureOn('Targeted')).toBe(false)
    expect(toggly.features.value.Targeted).toBeUndefined()
  } finally { toggly.client.destroy(); vi.unstubAllGlobals() }
})


it('resolves middleware context lazily after authenticated application middleware', async () => {
  const middleware = (await import('../src/runtime/snapshot-middleware')).default
  const event = { context: { togglyEvalContext: { identity: 'before' } } } as any
  middleware(event)
  event.context.togglyEvalContext = { identity: 'authenticated' }
  expect(await event.context.togglySsrSnapshot()).toEqual({ features: { Enabled: true, Disabled: false }, identity: 'authenticated' })
})
