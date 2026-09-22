import type { App } from 'vue'
import { Toggly, type TogglyOptions } from './toggly.service'
import Feature from '../components/Feature.vue'
import FeatureGateBuilder from '../components/FeatureGateBuilder.vue'

export default {
  install: (app: App, options: TogglyOptions) => {
    const $toggly = new Toggly().init(options)
    const unmount = app.unmount.bind(app)
    app.unmount = () => {
      try { unmount() } finally { $toggly.dispose() }
    }
    app.provide('$toggly', $toggly)
    app.component('Feature', Feature)
    app.component('FeatureGateBuilder', FeatureGateBuilder)
  },
}
