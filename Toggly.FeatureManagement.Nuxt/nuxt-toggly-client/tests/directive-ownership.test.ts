import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {defineComponent, h, withDirectives} from 'vue'
import {mount, flushPromises} from '@vue/test-utils'
import {gunzipSync} from 'node:zlib'
import {createToggly, getTogglyClient, resetToggly} from '../src/composables/useToggly'
import {vFeature, vFeatureShow, vFeatureClass} from '../src/directives/vFeature'
let enabled: boolean
let packets: any[]
const options = {appKey: 'directive-owner', refreshInterval: 0, enableLiveUpdates: false, persistIdentity: false}
async function telemetryFetch(_url: any, init: any) {
  const bytes = typeof init.body === 'string' ? Buffer.from(init.body) : Buffer.from(await new Response(init.body).arrayBuffer())
  packets.push(JSON.parse((new Headers(init.headers).get('content-encoding') === 'gzip' ? gunzipSync(bytes) : bytes).toString()))
  return {status: 202}
}
beforeEach(() => {
  enabled = true; packets = []; localStorage.clear(); process.env.TOGGLY_DISABLE_TELEMETRY = '0'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({On: enabled}))))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {resetToggly(); vi.unstubAllGlobals(); vi.restoreAllMocks(); process.env.TOGGLY_DISABLE_TELEMETRY = '1'})
for (const [kind, directive] of [['display', vFeature], ['visibility', vFeatureShow], ['class', vFeatureClass]] as const) {
  it(`moves mounted ${kind} to replacement owners and releases subscriptions on unmount`, async () => {
    const a = createToggly({...options, identity: 'alice', telemetryFetch}); await a.init()
    const wrapper = mount(defineComponent({setup: () => () => withDirectives(h('span', 'content'), [[directive, 'On', 'enabled']])}))
    const visible = () => kind === 'display' ? (wrapper.element as HTMLElement).style.display !== 'none' : kind === 'visibility' ? (wrapper.element as HTMLElement).style.visibility === 'visible' : wrapper.classes().includes('enabled')
    let release!: (response: Response) => void
    try {
      await flushPromises(); expect(visible()).toBe(true); await a.telemetry.flushTelemetry()
      expect(packets).toEqual([{k: 'directive-owner', e: 'Production', u: 'alice', f: {On: {enabled: [1]}}}]); packets = []
      vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => {release = resolve}))
      const retiredRefresh = a.refresh(); await flushPromises()
      enabled = false
      const b = createToggly({...options, identity: 'bob', telemetryFetch}); await b.init(); await flushPromises()
      expect(visible()).toBe(false)
      release(new Response(JSON.stringify({On: true}))); await retiredRefresh; await flushPromises()
      expect(visible()).toBe(false); await a.telemetry.flushTelemetry(); await b.telemetry.flushTelemetry()
      expect(packets).toEqual([{k: 'directive-owner', e: 'Production', u: 'bob', f: {On: {disabled: [1]}}}]); packets = []
      enabled = true; await b.refresh(); await flushPromises(); expect(visible()).toBe(true)
      await b.telemetry.flushTelemetry(); expect(packets).toEqual([{k: 'directive-owner', e: 'Production', u: 'bob', f: {On: {enabled: [1]}}}]); packets = []
      b.client.destroy(); await flushPromises(); expect(getTogglyClient()).toBeNull(); expect(visible()).toBe(false)
      const c = createToggly({...options, identity: 'carol', telemetryFetch, localGates: [{id: 'deny', flagKeys: ['On'], isEnabled: () => false}]})
      await c.init(); await flushPromises(); expect(visible()).toBe(false); await c.telemetry.flushTelemetry()
      expect(packets).toEqual([{k: 'directive-owner', e: 'Production', u: 'carol', f: {On: {disabled: [1]}}}]); packets = []
      wrapper.unmount(); await c.refresh(); await flushPromises(); await c.telemetry.flushTelemetry(); expect(packets).toEqual([])
    } finally {release?.(new Response(JSON.stringify({On: true}))); if (wrapper.exists()) wrapper.unmount()}
  })
}
it('does not recursively refresh a mounted directive for an identical token from an evaluation hook', async () => {
  const owner = createToggly({...options, identity: 'alice', instanceId: 'token-a', telemetryFetch}); await owner.init()
  let calls = 0
  owner.client.addHook({getMetadata: () => ({name: 'same-context'}), beforeEvaluation: async () => {
    if (++calls > 3) throw new Error('Recursive context notification')
    await owner.setContext({instanceId: ' token-a '})
  }})
  const wrapper = mount(defineComponent({setup: () => () => withDirectives(h('span'), [[vFeature, 'On']])}))
  try {
    await flushPromises(); expect(calls).toBe(1); expect(fetch).toHaveBeenCalledTimes(1)
    expect((wrapper.element as HTMLElement).style.display).toBe('')
    await owner.telemetry.flushTelemetry(); expect(packets).toEqual([{k: 'directive-owner', e: 'Production', i: 'token-a', f: {On: {enabled: [1]}}}])
  } finally {wrapper.unmount()}
})
for (const [kind, directive] of [['display', vFeature], ['visibility', vFeatureShow], ['class', vFeatureClass]] as const) {
  it(`registers ${kind} teardown before a synchronous initial evaluation can unmount`, async () => {
    const owner = createToggly({...options, identity: 'alice', telemetryFetch}); await owner.init()
    const el = document.createElement('span')
    let calls = 0
    owner.client.addHook({getMetadata: () => ({name: 'unmount'}), beforeEvaluation: () => {
      calls++; (directive.beforeUnmount as Function)(el)
    }})
    const binding = {value: 'On', modifiers: {}, arg: 'enabled'}
    ;(directive.mounted as Function)(el, binding)
    await flushPromises(); expect(calls).toBe(1)
    await owner.refresh(); await flushPromises(); expect(calls).toBe(1)
  })
  it(`keeps ${kind} bound to a replacement created during the initial evaluation`, async () => {
    const owner = createToggly({...options, identity: 'alice', telemetryFetch}); await owner.init()
    let replacement: ReturnType<typeof createToggly> | undefined
    owner.client.addHook({getMetadata: () => ({name: 'replace'}), beforeEvaluation: () => {
      enabled = false; replacement = createToggly({...options, identity: 'bob', telemetryFetch})
    }})
    const wrapper = mount(defineComponent({setup: () => () => withDirectives(h('span'), [[directive, 'On', 'enabled']])}))
    const visible = () => kind === 'display' ? (wrapper.element as HTMLElement).style.display !== 'none' : kind === 'visibility' ? (wrapper.element as HTMLElement).style.visibility === 'visible' : wrapper.classes().includes('enabled')
    try {
      await replacement!.init(); await flushPromises(); expect(visible()).toBe(false)
      enabled = true; await replacement!.refresh(); await flushPromises(); expect(visible()).toBe(true)
    } finally {wrapper.unmount()}
  })
}
