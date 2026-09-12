import { StrictMode, useContext } from 'react'
import { createRoot } from 'react-dom/client'
import { context, createTogglyProvider, Feature, Toggly, useFeatureFlag, useFeatureGate } from '@ops-ai/react-feature-flags-toggly'

let localEnabled = true
let activeSubscriptions = 0
const observed = new WeakSet<Toggly>()
declare global { interface Window { fixture: { readonly activeSubscriptions: number } } }
window.fixture = { get activeSubscriptions() { return activeSubscriptions } }

function ConsumerApp() {
  const toggly = useContext(context).toggly as Toggly
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
  const flag = useFeatureFlag('release')
  const gate = useFeatureGate(['release', 'second'])
  return <>
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
const root = createRoot(document.getElementById('root')!)
void createTogglyProvider({
  appKey: 'fixture', environment: 'Test', identity: 'first-user',
  baseURI: `${window.location.origin}/definitions-fixture`, verifySignatures: false,
  enableLiveUpdates: false, persistCache: false,
  featureDefaults: { release: false, second: true },
  localGates: [{ id: 'device', flagKeys: ['release'], isEnabled: () => localEnabled }],
}).then(TogglyProvider => root.render(<StrictMode><TogglyProvider><ConsumerApp /></TogglyProvider></StrictMode>))
