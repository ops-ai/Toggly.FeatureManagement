import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Toggly,
  createTogglyProvider,
} from '@ops-ai/react-feature-flags-toggly'

async function verify() {
  const toggly = new Toggly({ featureDefaults: { release: true } })
  assert.equal(await toggly.isFeatureOn('release'), true)

  const TogglyProvider = await createTogglyProvider({
    featureDefaults: { release: true },
  })
  const markup = renderToStaticMarkup(
    <TogglyProvider>
      <span>react-19-provider</span>
    </TogglyProvider>,
  )

  assert.equal(markup, '<span>react-19-provider</span>')
}

void verify()
