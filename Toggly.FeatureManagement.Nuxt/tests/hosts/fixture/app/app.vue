<script setup lang="ts">
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createToggly, useFeatureGate as useClientGate, TOGGLY_INJECTION_KEY } from '@ops-ai/nuxt-toggly-client'
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
  const factory = toggly.client.config.frontendTelemetryFactory
  const diagnostic = new URLSearchParams(location.search).has('evaluationDiagnostic') && factory
  await toggly.init({ appKey: 'fixture', identity: 'alice', baseUri: location.origin + '/api/definitions', refreshInterval: 0, enableLiveUpdates: false,
    ...(diagnostic ? {frontendTelemetryFactory: (config: any) => {
      const runtime = diagnostic(config)
      evaluationTrace.push({phase:evaluationPhase,kind:'factory',present:!!runtime,usageEnabled:runtime?.usageEnabled})
      return runtime
    }} : {}),
  })
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
    return {
      calls: evaluationTrace.slice(start),
      config: {
        appKey: toggly.client.config.appKey,
        metricsBaseUrl: toggly.client.config.metricsBaseUrl,
        enableTelemetry: toggly.client.config.enableTelemetry,
        enableUsageTracking: toggly.client.config.enableUsageTracking,
        frontendFactory: typeof toggly.client.config.frontendTelemetryFactory,
        environmentDisabled: typeof process !== 'undefined' && process.env?.TOGGLY_DISABLE_TELEMETRY,
      },
    }
  }
  ;(window as any).verifyFacadeOwnership = async (dispose: boolean) => {
    const owner=createToggly({appKey:'ownership-fixture',identity:'alice',persistIdentity:false,
      baseUri:location.origin+'/api/definitions',metricsBaseUrl:useRuntimeConfig().public.toggly.metricsBaseUrl,refreshInterval:0,enableLiveUpdates:false})
    const element=document.createElement('div');document.body.appendChild(element)
    const app=createApp(defineComponent({setup(){const gate=useClientGate(['Enabled']);return()=>h('span',String(gate.isEnabled.value))}}))
    app.provide(TOGGLY_INJECTION_KEY,owner);app.mount(element)
    const original=globalThis.fetch
    let release!:()=>void,enter!:()=>void
    const held=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{enter=resolve})
    globalThis.fetch=async(input,options)=>{
      const response=await original(input,options)
      if(String(input).includes('/api/definitions/')){enter();await held}
      return response
    }
    const snapshot=()=>({ready:owner.isReady.value,loading:owner.isLoading.value,coreReady:owner.client.state.initialized,flag:owner.features.value.Enabled??null,gate:element.textContent})
    try {
      const initial=owner.init();await started
      if(dispose)owner.client.destroy();else await owner.refresh()
      const pending=snapshot();await owner.telemetry.flushTelemetry()
      release();await initial;await nextTick();await new Promise(resolve=>setTimeout(resolve,0))
      const settled=snapshot();await owner.telemetry.flushTelemetry()
      return {pending,settled}
    } finally {release();globalThis.fetch=original;app.unmount();element.remove();owner.client.destroy()}
  }
  ;(window as any).verifyInheritedToken = async (evaluationMode: 'local'|'remote') => {
    const owner=createToggly({appKey:'inherited-'+evaluationMode,evaluationMode,instanceId:' ',identity:'alice',persistIdentity:false,
      baseUri:location.origin+'/minted-definitions?i=retired&%69=older&keep=a&keep=b',metricsBaseUrl:useRuntimeConfig().public.toggly.metricsBaseUrl,refreshInterval:0,enableLiveUpdates:false})
    const results:boolean[]=[]
    const check=async()=>{results.push(await owner.isFeatureOn(evaluationMode==='local'?'Raw':'Flag'));await owner.telemetry.flushTelemetry()}
    try {
      await owner.init();await check();await owner.setContext({instanceId:'token-a'});await check();await owner.setContext({identity:'bob'});await check()
      await owner.setContext({instanceId:'token-a'});await check();await owner.setContext({instanceId:' '});await check()
      return results
    } finally {owner.client.destroy()}
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
