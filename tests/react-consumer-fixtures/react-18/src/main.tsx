import { StrictMode, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { context, createTogglyProvider, Feature, Toggly, useFeatureFlag, useFeatureGate, useVariant } from '@ops-ai/react-feature-flags-toggly'

let localEnabled = true
let activeSubscriptions = 0
const observed = new WeakSet<Toggly>()
declare global { interface Window { fixture: { readonly activeSubscriptions: number; service?: Toggly; recordTelemetry?: () => void; remount?: () => void; previousService?: Toggly } } }
window.fixture = { get activeSubscriptions() { return activeSubscriptions } }

function ConsumerApp() {
  const toggly = useContext(context).toggly as Toggly
  window.fixture.service = toggly
  window.fixture.recordTelemetry = () => { toggly.recordUsage('release'); toggly.recordView('release', 'control'); toggly.incrementCounter('orders', 2); toggly.setGauge('cart', 3) }
  // Observe real subscription cleanup without replacing evaluation or notifications.
  if (toggly && !observed.has(toggly)) {
    observed.add(toggly)
    for (const method of ['subscribeFeaturesRefresh', 'subscribeLocalGatesChanged'] as const) {
      const subscribe = toggly[method].bind(toggly)
      toggly[method] = listener => {
        activeSubscriptions++
        const unsubscribe = subscribe(listener)
        return () => { activeSubscriptions--; unsubscribe() }
      }
    }
  }
  const variant = useVariant('release')
  const flag = useFeatureFlag('release')
  const gate = useFeatureGate(['release', 'second'])
  return <>
    <span data-testid="variant-name">{variant?.name ?? 'none'}</span>
    <Feature featureKey="release" variant="control"><span data-testid="variant-visible">control</span></Feature>
    <span data-testid="provider">{toggly ? 'connected' : 'missing'}</span>
    <span data-testid="flag">{flag.isLoading ? 'loading' : flag.isEnabled ? 'on' : 'off'}</span>
    <span data-testid="gate">{gate.isEnabled ? 'on' : 'off'}</span>
    <Feature featureKey="release"><span data-testid="visible">release-on</span></Feature>
    <Feature featureKey="release" negate><span data-testid="negated">release-off</span></Feature>
    <Feature featureKey="release" render={enabled => <span data-testid="render">{enabled ? 'on' : 'off'}</span>} />
    <button id="local-off" onClick={() => { localEnabled = false; toggly.notifyLocalGatesChanged() }}>Disable local gate</button>
    <button id="local-on" onClick={() => { localEnabled = true; toggly.notifyLocalGatesChanged() }}>Enable local gate</button>
    <button id="context" onClick={() => void toggly.setContext({ identity: 'second-user', groups: ['testers'], claims: { role: 'tester' } })}>Change context</button>
    <button id="refresh" onClick={() => void toggly._loadFeatures(true)}>Refresh definitions</button>
    <button id="unmount" onClick={() => root.unmount()}>Unmount</button>
  </>
}
let root = createRoot(document.getElementById('root')!)
void createTogglyProvider({
  metricsBaseUrl: new URLSearchParams(window.location.search).get('metrics') ?? window.location.origin,
  appKey: 'fixture', environment: 'Test', identity: 'first-user',
  baseURI: `${window.location.origin}/definitions-fixture`, verifySignatures: false,
  enableVariants: true, enableLiveUpdates: false, persistCache: false,
  featureDefaults: { release: false, second: true },
  localGates: [{ id: 'device', flagKeys: ['release'], isEnabled: () => localEnabled }],
}).then(TogglyProvider => {
  window.fixture.remount = () => {
    window.fixture.previousService = window.fixture.service
    root = createRoot(document.getElementById('root')!)
    root.render(<StrictMode><TogglyProvider><ConsumerApp /></TogglyProvider></StrictMode>)
  }
  root.render(<StrictMode><TogglyProvider><ConsumerApp /></TogglyProvider></StrictMode>)
})
