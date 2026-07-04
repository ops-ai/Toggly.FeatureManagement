declare module '#toggly/on-error' {
  import type { TogglyConfig } from '@ops-ai/nuxt-toggly-core'

  const onError: TogglyConfig['onError']
  export default onError
}

declare module '#app' {
  export interface NuxtPluginApp {
    vueApp: {
      provide: (key: string, value: unknown) => void
      directive: (name: string, directive: unknown) => void
    }
  }

  export function defineNuxtPlugin(
    plugin: (nuxtApp: NuxtPluginApp) => unknown | Promise<unknown>
  ): unknown

  export function useRuntimeConfig(): {
    public: {
      toggly: unknown
    }
  }
}

declare module '#imports' {
  export function defineNitroPlugin(
    plugin: () => unknown | Promise<unknown>
  ): unknown

  export function useRuntimeConfig(): {
    public: {
      toggly: unknown
    }
  }
}
