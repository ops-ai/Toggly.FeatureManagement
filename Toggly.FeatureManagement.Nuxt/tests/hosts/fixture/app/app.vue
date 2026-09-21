<script setup lang="ts">
import { createToggly } from '@ops-ai/nuxt-toggly-client'
const toggly = useToggly()
const evaluationTrace: unknown[] = []
let evaluationPhase = 'mount'
if (import.meta.client && new URLSearchParams(location.search).has('evaluationDiagnostic')) {
  for (const method of ['isFeatureOn','evaluateFeatureGate'] as const) {
    const original = toggly.client[method].bind(toggly.client) as (...args: any[]) => Promise<boolean>
    ;(toggly.client as any)[method] = async (...args: any[]) => {
      const entry = {phase:evaluationPhase,method,args,identity:toggly.client.identity,initialized:toggly.client.state.initialized,result:undefined as boolean|undefined}
      evaluationTrace.push(entry)
      entry.result = await original(...args)
      return entry.result
    }
  }
}

const { isEnabled } = useFeatureFlag('Enabled')
const { isEnabled: any } = useFeatureGate(['Enabled', 'Disabled'], 'any')
const mounted = ref(false)
const ssrCore = useState<boolean | null>('ssr-core', () => null)
onServerPrefetch(async () => { ssrCore.value = await toggly.client.isFeatureOn('Targeted') })
const initialized = ref(false)
const coreTarget = ref<boolean | null>(null)
const coreGate = ref<boolean | null>(null)
async function updateCoreFlags() {
  coreTarget.value = await toggly.client.isFeatureOn('Targeted')
  coreGate.value = await toggly.client.evaluateFeatureGate(['Targeted', 'Disabled'], 'any')
}
onMounted(async () => { await updateCoreFlags(); mounted.value = true })
async function identifyBob() { await toggly.setIdentity('bob'); await updateCoreFlags() }
async function refresh() { await toggly.refresh(); await updateCoreFlags() }
async function initialize() {
  await toggly.init({ appKey: 'fixture', identity: 'alice', baseUri: location.origin + '/api/definitions', refreshInterval: 0, enableLiveUpdates: false })
  initialized.value = true
}
async function emitTelemetry() {
  await toggly.isFeatureOn('Enabled')
  toggly.telemetry.recordUsage('Enabled', 'blue')
  toggly.telemetry.recordView('Enabled', 'green')
  toggly.telemetry.incrementCounter('fixture-counter', 2)
  toggly.telemetry.setGauge('fixture-gauge', 3)
  await toggly.telemetry.flushTelemetry()
}
function exitTelemetry() {
  toggly.telemetry.incrementCounter('pagehide-counter')
  window.dispatchEvent(new Event('pagehide'))
}
async function flushTelemetry() { await toggly.telemetry.flushTelemetry() }
async function replaceTelemetryOwner() {
  const common = { baseUri: location.origin + '/api/definitions', metricsBaseUrl: useRuntimeConfig().public.toggly.metricsBaseUrl, refreshInterval: 0, enableLiveUpdates: false }
  const oldOwner = createToggly({ ...common, appKey: 'old-app' })
  await oldOwner.init()
  oldOwner.telemetry.incrementCounter('old-owner-count')
  const newOwner = createToggly({ ...common, appKey: 'new-app' })
  await newOwner.init()
  oldOwner.telemetry.incrementCounter('stale-owner-count')
  newOwner.telemetry.incrementCounter('new-owner-count')
  await newOwner.telemetry.flushTelemetry()
}
onMounted(() => {
  ;(window as any).evaluationDiagnostic = async (phase: string) => {
    evaluationPhase = phase
    const start = evaluationTrace.length
    if (phase === 'initialize') await initialize()
    if (phase === 'identity') await identifyBob()
    if (phase === 'refresh') await refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushTelemetry()
    return evaluationTrace.slice(start)
  }
  ;(window as any).verifyMinted = async () => {
    const options = {appKey:'minted-fixture',instanceId:'token-a',identity:'legacy',groups:['private'],claims:{plan:'secret'},persistFeatures:true,
      baseUri:location.origin+'/minted-definitions',metricsBaseUrl:useRuntimeConfig().public.toggly.metricsBaseUrl,refreshInterval:0,enableLiveUpdates:false}
    const owner=createToggly(options)
    await owner.init()
    const results=[await owner.isFeatureOn('Flag')]
    await owner.setContext({instanceId:'token-b'});results.push(await owner.isFeatureOn('Flag'))
    await owner.setContext({instanceId:'token-a'});results.push(await owner.isFeatureOn('Flag'))
    await owner.init({evaluationMode:'local'});results.push(await owner.isFeatureOn('Raw'))
    await owner.init({evaluationMode:'remote'});results.push(await owner.isFeatureOn('Flag'))
    await owner.telemetry.flushTelemetry()
    const replacement=createToggly(options);await replacement.init();results.push(await replacement.isFeatureOn('Flag'))
    replacement.client.addHook({getMetadata:()=>({name:'reentrant'}),beforeEvaluation:async()=>{await replacement.setContext({instanceId:'token-b'})}})
    results.push(await replacement.isFeatureOn('Flag'));replacement.client.removeHook('reentrant')
    await replacement.telemetry.flushTelemetry()
    replacement.telemetry.incrementCounter('minted-pagehide');window.dispatchEvent(new Event('pagehide'))
    await new Promise(resolve=>setTimeout(resolve,50))
    replacement.client.destroy()
    return results
  }
})
</script>
<template>
  <main>
    <p id="initialized">{{ initialized }}</p>
    <p id="automatic">{{ toggly.features.value.Automatic }}</p>
    <p id="mounted">{{ mounted }}</p>
    <p id="flag">{{ isEnabled }}</p><p id="any">{{ any }}</p>
    <p id="ssr-core">{{ ssrCore }}</p>
    <p id="core-target">{{ coreTarget }}</p><p id="core-gate">{{ coreGate }}</p>
    <p id="target">{{ toggly.features.value.Targeted }}</p>
    <Feature feature-key="Enabled"><p id="gate">enabled</p></Feature>
    <Feature :feature-keys="['Enabled', 'Disabled']" requirement="all"><p id="all">all</p></Feature>
    <Feature feature-key="Disabled" negate><p id="negated">negated</p></Feature>
    <p v-feature-show="'Enabled'" id="directive">directive</p>
    <button id="init" @click="initialize">initialize</button>
    <button id="identity" @click="identifyBob">bob</button>
    <button id="refresh" @click="refresh">refresh</button>
    <button id="telemetry" @click="emitTelemetry">telemetry</button>
    <button id="flush-telemetry" @click="flushTelemetry">flush telemetry</button>
    <button id="pagehide" @click="exitTelemetry">pagehide</button>
    <button id="replace-owner" @click="replaceTelemetryOwner">replace owner</button>
  </main>
</template>
