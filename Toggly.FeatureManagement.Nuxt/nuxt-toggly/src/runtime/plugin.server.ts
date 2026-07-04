import { defineNitroPlugin, useRuntimeConfig } from '#imports'
import moduleOnError from '#toggly/on-error'
import { initServerToggly } from '@ops-ai/nuxt-toggly-server'
import type { ModuleOptions } from '../module/types'

export default defineNitroPlugin(async () => {
  const config = useRuntimeConfig().public.toggly as ModuleOptions

  if (!config.appKey) {
    console.warn('[Toggly] No appKey configured for server-side initialization')
    return
  }

  try {
    await initServerToggly({
      appKey: config.appKey,
      environment: config.environment,
      baseUri: config.baseUri,
      identity: config.identity,
      featureDefaults: config.featureDefaults,
      refreshInterval: 0, // Disable auto-refresh on server
      cache: config.serverCache,
      cacheTtl: config.serverCacheTtl,
      hooks: config.hooks,
      onError: moduleOnError,
    })

    if (config.debug) {
      console.log('[Toggly] Server initialized')
    }
  } catch (error) {
    if (config.debug) {
      console.error('[Toggly] Failed to initialize server:', error)
    }
  }
})
