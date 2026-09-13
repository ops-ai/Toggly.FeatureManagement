declare module '#toggly/on-error' {
  import type { TogglyConfig } from '@ops-ai/nuxt-toggly-core'

  const onError: TogglyConfig['onError']
  export default onError
}

declare module '#app' {
  export interface NuxtPluginApp {
    payload: Record<string, unknown>
    ssrContext?: { event: Parameters<typeof import('@ops-ai/nuxt-toggly-server').resolveEventEvalContext>[0] }
    hook: (name: string, callback: () => unknown) => void
    vueApp: {
      provide: (key: string | symbol, value: unknown) => void
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
    plugin: (nitroApp: import('nitropack').NitroApp) => unknown | Promise<unknown>
  ): unknown

  export function useRuntimeConfig(): {
    public: {
      toggly: unknown
    }
  }
}
