import type { Toggly } from './plugins/toggly.service'

declare module 'vue' {
  interface ComponentCustomProperties {
    $toggly: Toggly
  }
}
