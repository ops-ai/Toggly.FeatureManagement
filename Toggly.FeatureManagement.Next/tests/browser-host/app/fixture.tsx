'use client'
import { useEffect, useState } from 'react'
import { createTogglyClient } from '@ops-ai/nextjs-toggly-core/browser'
import { TogglyProvider, useToggly, useFeatureFlag, useFeatureGate, Feature, FeatureVariant, FeatureSwitch, type TogglyContextValue } from '@ops-ai/nextjs-toggly-client'

let current: TogglyContextValue
let localEnabled = true
function Probe() {
  const context = useToggly()
  current = context
  const flag = useFeatureFlag('On')
  const gate = useFeatureGate(['On', 'Second'], 'all')
  return <main>
    <span data-testid="flag">{flag.isEnabled ? 'on' : 'off'}</span>
    <span data-testid="gate">{gate.isAllowed ? 'on' : 'off'}</span>
    <Feature featureKey="On"><span data-testid="visible">visible</span></Feature>
    <Feature featureKey="On" negate><span data-testid="negated">negated</span></Feature>
    <FeatureVariant featureKey="On" enabled={<span data-testid="variant">on</span>} disabled={<span data-testid="variant">off</span>}/>
    <FeatureSwitch featureKey="On" cases={{on: <span data-testid="switch">on</span>, off: <span data-testid="switch">off</span>}}/>
    <button id="local-off" onClick={() => {localEnabled = false; current.client.notifyLocalGatesChanged()}}>Off</button>
    <button id="local-on" onClick={() => {localEnabled = true; current.client.notifyLocalGatesChanged()}}>On</button>
    <button id="context" onClick={() => current.setIdentity('second-user')}>Identity</button>
    <button id="refresh" onClick={() => current.refresh()}>Refresh</button>
  </main>
}

export default function Fixture() {
  const [mounted, setMounted] = useState(true)
  const [replacement, setReplacement] = useState(false)
  const [metrics, setMetrics] = useState<string | undefined>()
  useEffect(() => {setMetrics(new URLSearchParams(location.search).get('metrics') ?? undefined)}, [])
  useEffect(() => {
    Object.assign(window, {fixture: {
      get current() {return current},
      recordTelemetry() {
        current.client.recordUsage('On', 'ignored-user'); current.client.recordView('On', 'ignored-user', 'control')
        current.telemetry.incrementCounter('orders', 2); current.telemetry.setGauge('cart', 9); current.telemetry.setGauge('cart', 3)
      },
      async verifyMintedUrls() {
        const results = []
        for (const evaluationMode of ['remote', 'local'] as const) {
          const client = createTogglyClient({appKey:'url-fixture',environment:'Test',evaluationMode,instanceId:' mint ',identity:'private',groups:['private'],claims:{role:'private'},baseUri:`${location.origin}/url-fixture/?keep=ok&u=old&userId=old&g=one&g=two&claim.role=old&i=old&i=older`,enableTelemetry:false,enableLiveUpdates:false,refreshInterval:0})
          try {await client.init(); results.push(await client.isFeatureOn('On'))} finally {client.destroy()}
        }
        return results
      },
      async verifyCache() {
        const config = {appKey:'cache-fixture', environment:'Test', identity:'cache-user', instanceId:'cache-a', baseUri:`${location.origin}/cache-fixture`, metricsBaseUrl:metrics, persistFeatures:true, enableLiveUpdates:false, refreshInterval:0, enableTelemetry:false, featureDefaults:{On:false}}
        const client = createTogglyClient(config)
        try {
          const first = await client.init()
          await client.setContext({instanceId:'cache-b'})
          const second = await client.isFeatureOn('On')
          await client.setContext({instanceId:'cache-a'})
          const restored = await client.refresh()
          const active = await client.isFeatureOn('On')
          client.destroy()
          const reloaded = createTogglyClient(config)
          try {return {first, second, restored, active, persisted:await reloaded.init(), persistedActive:await reloaded.isFeatureOn('On'), entityAllowed:await reloaded.isFeatureOn('Entity',{kind:'User',key:'a',attributes:{role:'admin'}}), entityDenied:await reloaded.isFeatureOn('Entity',{kind:'User',key:'b',attributes:{role:'guest'}})}}
          finally {reloaded.destroy()}
        } finally {client.destroy()}
      },
      async verifyReentrantCheck() {
        const client=createTogglyClient({appKey:'cache-fixture', environment:'Test', identity:'cache-user', instanceId:'cache-a', baseUri:`${location.origin}/cache-fixture`, metricsBaseUrl:metrics, enableLiveUpdates:false, refreshInterval:0})
        try {
          await client.init()
          client.addHook({getMetadata:()=>({name:'reentrant'}),beforeEvaluation:async()=>{await client.setContext({instanceId:'cache-b'})}})
          const result=await client.isFeatureOn('On')
          client.recordUsage('After')
          await client.flushTelemetry()
          return result
        } finally {client.destroy()}
      },
      unmount() {setMounted(false)},
      remount() {setMounted(true)},
      replaceOwner() {setReplacement(true)},
    }})
  }, [metrics])
  return mounted && metrics ? <TogglyProvider config={{appKey: replacement ? 'replacement' : 'fixture', environment: replacement ? 'New' : 'Test', identity: 'first-user', instanceId: 'mint-a', groups: ['staff'], claims: {role: 'admin'}, metricsBaseUrl: metrics, baseUri: `${location.origin}/definitions-fixture`, enableLiveUpdates: false, refreshInterval: 0, persistIdentity: false, localGates: [{id: 'device', flagKeys: ['On'], isEnabled: () => localEnabled}]}}><Probe/></TogglyProvider> : <span>waiting</span>
}
