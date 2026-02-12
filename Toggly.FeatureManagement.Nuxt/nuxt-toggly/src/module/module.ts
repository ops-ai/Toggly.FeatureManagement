import {
  defineNuxtModule,
  addPlugin,
  createResolver,
  addImports,
  addComponent,
  addServerPlugin,
} from '@nuxt/kit'
import type { ModuleOptions } from './types'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@ops-ai/nuxt-toggly',
    configKey: 'toggly',
    compatibility: {
      nuxt: '^3.0.0',
    },
  },

  defaults: {
    debug: false,
    ssr: true,
    serverCache: true,
    serverCacheTtl: 60000,
    persistIdentity: true,
    persistFeatures: false,
    autoImport: true,
    globalComponents: true,
    globalDirectives: true,
    baseUri: 'https://client.toggly.io',
    environment: 'Production',
    refreshInterval: 180000,
    showFeatureDuringEvaluation: false,
  },

  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)

    // Add runtime config
    nuxt.options.runtimeConfig.public.toggly = options

    // Add client plugin
    addPlugin({
      src: resolve('../runtime/plugin.client'),
      mode: 'client',
    })

    // Add server plugin if SSR is enabled
    if (options.ssr) {
      addServerPlugin(resolve('../runtime/plugin.server'))
    }

    // Auto-import composables
    if (options.autoImport) {
      addImports([
        {
          name: 'useToggly',
          from: '@ops-ai/nuxt-toggly-client',
        },
        {
          name: 'useFeatureFlag',
          from: '@ops-ai/nuxt-toggly-client',
        },
        {
          name: 'useFeatureOff',
          from: '@ops-ai/nuxt-toggly-client',
        },
        {
          name: 'useFeatureGate',
          from: '@ops-ai/nuxt-toggly-client',
        },
        {
          name: 'useFeatureProps',
          from: '@ops-ai/nuxt-toggly-client',
        },
      ])

      // Server-side imports
      addImports([
        {
          name: 'useServerToggly',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'isServerFeatureOn',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'isServerFeatureOff',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'useEventToggly',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'isEventFeatureOn',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'isEventFeatureOff',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'evaluateEventFeatureGate',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'defineFeatureMiddleware',
          from: '@ops-ai/nuxt-toggly-server',
        },
        {
          name: 'defineFeatureHandler',
          from: '@ops-ai/nuxt-toggly-server',
        },
      ])
    }

    // Register global components
    if (options.globalComponents) {
      addComponent({
        name: 'Feature',
        export: 'Feature',
        filePath: '@ops-ai/nuxt-toggly-client',
      })

      addComponent({
        name: 'FeatureEnabled',
        export: 'FeatureEnabled',
        filePath: '@ops-ai/nuxt-toggly-client',
      })

      addComponent({
        name: 'FeatureDisabled',
        export: 'FeatureDisabled',
        filePath: '@ops-ai/nuxt-toggly-client',
      })
    }

    // Log debug info
    if (options.debug) {
      console.log('[Toggly] Module initialized with options:', {
        appKey: options.appKey ? '***' : undefined,
        environment: options.environment,
        ssr: options.ssr,
        serverCache: options.serverCache,
      })
    }
  },
})
