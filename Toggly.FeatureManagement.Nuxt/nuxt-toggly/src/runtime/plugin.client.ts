import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import moduleOnError from '#toggly/on-error'
import {
  createToggly,
  TOGGLY_INJECTION_KEY,
  vFeature,
  vFeatureShow,
  vFeatureClass,
} from '@ops-ai/nuxt-toggly-client'
import type { ModuleOptions } from '../module/types'

export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig().public.toggly as ModuleOptions

  const snapshot = nuxtApp.payload.toggly as { features: Record<string, boolean>; identity?: string } | undefined

  // Create Toggly instance
  const toggly = createToggly({
    appKey: config.appKey,
    environment: config.environment,
    baseUri: config.baseUri,
    identity: snapshot?.identity ?? config.identity,
    // Seed targeting before initialization so the first evaluation uses it.
    groups: config.groups ? [...config.groups] : config.groups,
    claims: config.claims ? { ...config.claims } : config.claims,
    featureDefaults: config.featureDefaults,
    showFeatureDuringEvaluation: config.showFeatureDuringEvaluation,
    refreshInterval: config.refreshInterval,
    enableLiveUpdates: config.enableLiveUpdates,
    persistIdentity: config.persistIdentity,
    persistFeatures: config.persistFeatures,
    hooks: config.hooks,
    onError: moduleOnError,
  })

  if (snapshot) {
    // Hydration is current state, never fallback defaults for another identity.
    toggly.client.hydrateEvaluatedFeatures(snapshot.features)
    toggly.isReady.value = true
  }

  // Provide to Vue app
  nuxtApp.vueApp.provide(TOGGLY_INJECTION_KEY, toggly)

  // Register global directives if enabled
  if (config.globalDirectives !== false) {
    nuxtApp.vueApp.directive('feature', vFeature)
    nuxtApp.vueApp.directive('feature-show', vFeatureShow)
    nuxtApp.vueApp.directive('feature-class', vFeatureClass)
  }

  // Initialize if appKey is provided
  const initialize = async () => {
    if (!config.appKey) return
    try {
      await toggly.init()

      if (config.debug) {
        console.log('[Toggly] Client initialized with features:', toggly.features.value)
      }
    } catch (error) {
      if (config.debug) {
        console.error('[Toggly] Failed to initialize client:', error)
      }
    }
  }

  // Keep the server snapshot through hydration; refresh only after Vue mounts.
  if (snapshot) {
    nuxtApp.hook('app:mounted', initialize)
  } else {
    await initialize()
  }

  // Provide helper for useToggly
  return {
    provide: {
      toggly,
    },
  }
})
