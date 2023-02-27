import { Toggly } from './toggly'

declare module 'vue' {
  interface ComponentCustomProperties {
    $toggly: Toggly
  }
}
