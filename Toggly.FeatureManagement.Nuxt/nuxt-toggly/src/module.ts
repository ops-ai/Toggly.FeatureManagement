import {
  defineNuxtModule,
  addPlugin,
  createResolver,
  addImports,
  addComponent,
  addServerPlugin,
  addServerHandler,
  addServerImports,
  addTemplate,
} from '@nuxt/kit'
import type { ModuleOptions } from './module/types'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@ops-ai/nuxt-toggly',
    configKey: 'toggly',
    compatibility: {
      nuxt: '^3.0.0 || ^4.0.0',
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
    baseUri: 'https://definitions.toggly.io',
    environment: 'Production',
    refreshInterval: 180000,
    showFeatureDuringEvaluation: false,
    enableTelemetry: true,
    enableUsageTracking: true,
    enableMetrics: true,
    telemetryFlushIntervalMs: 45000,
  },

  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const { onError, ...serializableOptions } = options

    const onErrorTemplate = addTemplate({
      filename: 'toggly-on-error-handler.mjs',
      write: true,
      getContents: () =>
        onError
          ? `export default ${onError.toString()}`
          : 'export default undefined',
    })
    nuxt.options.alias['#toggly/on-error'] = onErrorTemplate.dst
    nuxt.options.nitro = nuxt.options.nitro || {}
    nuxt.options.nitro.alias = {
      ...nuxt.options.nitro.alias,
      '#toggly/on-error': onErrorTemplate.dst,
    }

    // Non-serializable callbacks are injected via the virtual module above.
    nuxt.options.runtimeConfig.public.toggly = serializableOptions as ModuleOptions

    // Add client plugin
    addPlugin({
      src: resolve('./runtime/plugin.client'),
      mode: 'client',
    })

    // Each Vue SSR request needs its own injection, even in defaults-only mode.
    addPlugin({ src: resolve('./runtime/plugin.ssr'), mode: 'server' })

    // Add server plugin if SSR is enabled
    if (options.ssr) {
      addServerPlugin(resolve('./runtime/plugin.server'))
      addServerHandler({ handler: resolve('./runtime/snapshot-middleware'), middleware: true })
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

      // Preserve existing Vue SSR imports and add Nitro route registration.
      const serverImports = [
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
      ]
      addImports(serverImports)
      addServerImports(serverImports)
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

export type { ModuleOptions, RuntimeConfig } from './module/types'

// Re-export all from sub-packages for convenience
export * from '@ops-ai/nuxt-toggly-core'
export * from '@ops-ai/nuxt-toggly-client'
export * from '@ops-ai/nuxt-toggly-server'
// Resolve the client/server wildcard collision in favor of the trusted public
// core factory that this aggregate package has always exposed.
export { createTogglyClient } from '@ops-ai/nuxt-toggly-core'
