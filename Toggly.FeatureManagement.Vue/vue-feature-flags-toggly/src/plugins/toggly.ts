import togglyService, { TogglyOptions } from './toggly.service'
import Feature from '../components/Feature.vue'

export default {
  install: (app, options: TogglyOptions) => {
    const $toggly = togglyService.init(options)
    app.provide('$toggly', $toggly)
    app.component('Feature', Feature)
  },
}
