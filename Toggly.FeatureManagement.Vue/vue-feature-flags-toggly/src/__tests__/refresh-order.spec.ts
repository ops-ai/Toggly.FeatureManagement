import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {defineComponent, h} from 'vue'
import {flushPromises, mount} from '@vue/test-utils'
import {Toggly} from '../plugins/toggly.service'
import {useFeatureFlag} from '../composables/useFeatureGate'
import {useVariant} from '../composables/useVariant'
import Feature from '../components/Feature.vue'
import FeatureGateBuilder from '../components/FeatureGateBuilder.vue'

let definitions: Record<string, unknown>
let sent: any[]
const cleanups: (() => void)[] = []
beforeEach(() => {
  definitions = {On: {enabled: true, variant: 'blue'}}; sent = []
  vi.stubGlobal('CompressionStream', undefined)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/api/frontend/telemetry')) {sent.push(JSON.parse(init!.body as string)); return {status: 202}}
    return new Response(JSON.stringify(definitions), {status: 200})
  }))
})
afterEach(async () => {cleanups.splice(0).reverse().forEach(cleanup => cleanup()); await flushPromises(); vi.unstubAllGlobals(); vi.restoreAllMocks()})
function client() {
  const service = new Toggly().init({appKey: 'refresh-order', environment: 'Test', instanceId: 'mint-a',
    enableVariants: true, persistCache: false, enableLiveUpdates: false})
  cleanups.push(() => service.dispose())
  return service
}
function host(kind: string, service: Toggly) {
  const wrapper = mount(defineComponent({setup() {
    if (kind === 'composable') {const state = useFeatureFlag('On', {toggly: service}); return () => h('span', `${state.isEnabled.value}/${state.isLoading.value}`)}
    if (kind === 'variant') {const state = useVariant('On', service); return () => h('span', `${state.variant.value?.name ?? ''}/${state.isLoading.value}`)}
    return () => kind === 'Feature' ? h(Feature, {featureKey: 'On'}, () => h('span', 'visible'))
      : h(FeatureGateBuilder, {featureKey: 'On'}, {default: ({enabled}: {enabled: boolean}) => h('span', String(enabled))})
  }}), {global: {provide: {$toggly: service}}})
  cleanups.push(() => wrapper.unmount())
  return wrapper
}
for (const phase of ['beforeEvaluation', 'afterEvaluation'] as const) {
  it.each(['composable', 'Feature', 'FeatureGateBuilder'])(`retains a same-context update during pending ${phase}: %s`, async kind => {
    const service = client(); await service._loadFeatures()
    let release!: () => void
    let first = true
    service.addHook({getMetadata: () => ({name: 'delayed'}), [phase]: () => {
      if (first) {first = false; return new Promise<void>(resolve => {release = resolve})}
    }})
    const wrapper = host(kind, service); await flushPromises()
    cleanups.push(() => release())
    definitions = {On: {enabled: false, variant: 'red'}}
    expect(await service._loadFeatures(true)).toEqual({On: false}); await flushPromises()
    const latest = kind === 'Feature' ? '' : kind === 'composable' ? 'false/false' : 'false'
    expect(wrapper.text()).toBe(latest)
    release(); await flushPromises(); expect(wrapper.text()).toBe(latest)
    await service.flushTelemetry()
    expect(sent).toEqual([{k: 'refresh-order', e: 'Test', i: 'mint-a', f: {On: {blue: [1], disabled: [1]}}}])
  })
}
it.each(['composable', 'Feature', 'FeatureGateBuilder', 'variant'])('counts initial hydration once and each later actual UI evaluation once: %s', async kind => {
  const service = client(); const wrapper = host(kind, service)
  await flushPromises(); await service.flushTelemetry()
  expect(wrapper.text()).toBe(kind === 'variant' ? 'blue/false' : kind === 'Feature' ? 'visible' : kind === 'composable' ? 'true/false' : 'true')
  expect(sent).toEqual([{k: 'refresh-order', e: 'Test', i: 'mint-a', f: {On: {blue: [1]}}}]); sent.length = 0
  definitions = {On: {enabled: false, variant: 'red'}}
  await service._loadFeatures(true); await flushPromises(); await service.flushTelemetry()
  expect(wrapper.text()).toBe(kind === 'variant' ? '/false' : kind === 'Feature' ? '' : kind === 'composable' ? 'false/false' : 'false')
  expect(sent).toEqual([{k: 'refresh-order', e: 'Test', i: 'mint-a', f: {On: {disabled: [1]}}}])
})
it('imports and evaluates in memory when the localStorage getter throws', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!
  vi.resetModules()
  Object.defineProperty(window, 'localStorage', {configurable: true, get() {throw new DOMException('denied', 'SecurityError')}})
  try {
    const {Toggly: StorageDeniedToggly} = await import('../plugins/toggly.service')
    const service = new StorageDeniedToggly().init({appKey: 'denied', environment: 'Test', enableVariants: true, enableLiveUpdates: false})
    try {await service._loadFeatures(); expect(service.getVariant('On')?.name).toBe('blue'); await service.flushTelemetry(); expect(sent[0].f.On.blue).toEqual([1])}
    finally {service.dispose()}
  } finally {Object.defineProperty(window, 'localStorage', descriptor); vi.resetModules()}
})
it.each(['composable', 'Feature', 'FeatureGateBuilder'])('does not start an evaluation after unmount during hydration: %s', async kind => {
  let complete!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => {complete = resolve}))
  const service = client(); host(kind, service); await flushPromises()
  cleanups.pop()!()
  complete(new Response(JSON.stringify(definitions), {status: 200})); await flushPromises()
  await service.flushTelemetry(); expect(sent).toEqual([])
})
