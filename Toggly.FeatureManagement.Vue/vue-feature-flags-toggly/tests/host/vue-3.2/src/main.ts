import { createApp, defineComponent, h, inject, resolveComponent } from 'vue'
import { toggly, Toggly, useFeatureFlag, useFeatureGate, useVariant, FeatureGateBuilder } from '@ops-ai/vue-feature-flags-toggly'

let localEnabled = true
let service: Toggly
let previousService: Toggly | undefined
let activeSubscriptions = 0
const Host = defineComponent({
  setup() {
    service = inject<Toggly>('$toggly')!
    for (const method of ['subscribeFeaturesRefresh', 'subscribeLocalGatesChanged'] as const) {
      const original = service[method].bind(service)
      service[method] = listener => {
        activeSubscriptions++
        const unsubscribe = original(listener)
        let active = true
        return () => { if (active) {active = false; activeSubscriptions--; unsubscribe()} }
      }
    }
    const flag = useFeatureFlag('release')
    const gate = useFeatureGate({featureKeys: ['release', 'second'], requirement: 'all'})
    const variant = useVariant('release')
    const Feature = resolveComponent('Feature')
    return () => h('main', [
      h('span', {'data-testid': 'flag'}, flag.isEnabled.value ? 'on' : 'off'),
      h('span', {'data-testid': 'gate'}, gate.isEnabled.value ? 'on' : 'off'),
      h('span', {'data-testid': 'variant'}, variant.variant.value?.name ?? 'none'),
      h(Feature, {featureKey: 'release'}, () => h('span', {'data-testid': 'visible'}, 'visible')),
      h(Feature, {featureKey: 'release', negate: true}, () => h('span', {'data-testid': 'negated'}, 'negated')),
      h(FeatureGateBuilder, {featureKey: 'release'}, {default: ({enabled}: {enabled: boolean}) => h('span', {'data-testid': 'render'}, enabled ? 'on' : 'off')}),
      h('button', {id: 'local-off', onClick: () => {localEnabled = false; service.notifyLocalGatesChanged()}}, 'Off'),
      h('button', {id: 'local-on', onClick: () => {localEnabled = true; service.notifyLocalGatesChanged()}}, 'On'),
      h('button', {id: 'context', onClick: () => service.setContext({identity: 'second-user'})}, 'Context'),
      h('button', {id: 'refresh', onClick: () => service._loadFeatures(true)}, 'Refresh'),
    ])
  },
})
let app: ReturnType<typeof createApp>
const fixture = {
  get service() {return service},
  get previousService() {return previousService},
  get activeSubscriptions() {return activeSubscriptions},
  async verifyCache() {
    const options = {environment: 'Test', instanceId: 'token-a', metricsBaseUrl: new URLSearchParams(location.search).get('metrics')!, baseURI: `${location.origin}/cache-fixture`, persistCache: true, enableLiveUpdates: false}
    const results = []
    for (const enableVariants of [true, false]) {
      const config = {...options, appKey: `cache-${enableVariants}`, enableVariants}
      const first = new Toggly().init(config)
      await first._loadFeatures(true); first.dispose()
      const other = new Toggly().init({...config, enableVariants: !enableVariants})
      await other._loadFeatures(true); other.dispose()
      const restored = new Toggly().init(config)
      try {
        const flags = await restored._loadFeatures(true, {strict: true})
        const active = restored.getEffectiveFlagValue('On')
        const variant = enableVariants ? restored.getVariant('On') : null
        await restored.flushTelemetry()
        results.push({flags, active, variant})
      } finally {restored.dispose()}
    }
    const config = {...options, appKey: 'cache-aba', enableVariants: true, enableTelemetry: false}
    const owner = new Toggly().init(config)
    try {
      await owner._loadFeatures(true)
      await owner.setContext({instanceId: 'token-b'})
      const second = owner.getEffectiveFlagValue('On')
      await owner.setContext({instanceId: 'token-a'})
      const returned = await owner._loadFeatures(true, {strict: true})
      const active = owner.getEffectiveFlagValue('On')
      owner.dispose()
      const reloaded = new Toggly().init(config)
      try {return {results, second, returned, active, persisted: await reloaded._loadFeatures(true, {strict: true}), variant: reloaded.getVariant('On')}}
      finally {reloaded.dispose()}
    } finally {owner.dispose()}
  },
  recordTelemetry() {
    service.recordUsage('release'); service.recordView('release', 'control')
    service.incrementCounter('orders', 2); service.setGauge('cart', 9); service.setGauge('cart', 3)
  },
  unmount() {previousService = service; app.unmount()},
  remount() {
    app = createApp(Host)
    app.use(toggly, {appKey: 'fixture', environment: 'Test', identity: 'first-user', metricsBaseUrl: new URLSearchParams(location.search).get('metrics')!, baseURI: `${location.origin}/definitions-fixture`, persistCache: false, enableLiveUpdates: false, enableVariants: true, localGates: [{id: 'device', flagKeys: ['release'], isEnabled: () => localEnabled}]})
    app.mount('#app')
  },
}
Object.assign(window, {fixture})
fixture.remount()
