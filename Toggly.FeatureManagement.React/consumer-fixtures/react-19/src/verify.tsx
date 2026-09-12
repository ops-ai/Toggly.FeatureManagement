import assert from 'node:assert/strict'
import { useContext } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { context, createTogglyProvider, Feature, Toggly, useFeatureFlag, useFeatureGate } from '@ops-ai/react-feature-flags-toggly'

async function verify() {
  const service = new Toggly({ featureDefaults: { release: true } })
  assert.equal(await service.isFeatureOn('release'), true)
  const TogglyProvider = await createTogglyProvider({ featureDefaults: { release: true } })
  function Consumer() {
    assert.ok(useContext(context).toggly, 'Host useContext must see the packed SDK provider')
    const flag = useFeatureFlag('release')
    const gate = useFeatureGate(['release'], { defaultValue: true })
    assert.equal(flag.isLoading, true, 'Effects do not run during SSR')
    assert.equal(flag.isEnabled, false)
    assert.equal(gate.isEnabled, true)
    return <><span>shared-provider</span><Feature featureKey="release" render={enabled => <span>{enabled ? 'on' : 'off'}</span>} /></>
  }
  assert.equal(renderToStaticMarkup(<TogglyProvider><Consumer /></TogglyProvider>), '<span>shared-provider</span><span>off</span>')
  console.log('SSR provider/context, hooks and initial Feature state passed')
}
void verify()
