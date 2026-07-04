import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import moduleOnError from '#toggly/on-error'
import {
  createToggly,
  provideToggly,
  vFeature,
  vFeatureShow,
  vFeatureClass,
} from '@ops-ai/nuxt-toggly-client'
import type { ModuleOptions } from '../module/types'

export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig().public.toggly as ModuleOptions

  // Create Toggly instance
  const toggly = createToggly({
    appKey: config.appKey,
    environment: config.environment,
    baseUri: config.baseUri,
    identity: config.identity,
    featureDefaults: config.featureDefaults,
    showFeatureDuringEvaluation: config.showFeatureDuringEvaluation,
    refreshInterval: config.refreshInterval,
    persistIdentity: config.persistIdentity,
    persistFeatures: config.persistFeatures,
    hooks: config.hooks,
    onError: moduleOnError,
  })

  // Provide to Vue app
  nuxtApp.vueApp.provide('toggly', toggly)

  // Register global directives if enabled
  if (config.globalDirectives !== false) {
    nuxtApp.vueApp.directive('feature', vFeature)
    nuxtApp.vueApp.directive('feature-show', vFeatureShow)
    nuxtApp.vueApp.directive('feature-class', vFeatureClass)
  }

  // Initialize if appKey is provided
  if (config.appKey) {
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

  // Provide helper for useToggly
  return {
    provide: {
      toggly,
    },
  }
})
