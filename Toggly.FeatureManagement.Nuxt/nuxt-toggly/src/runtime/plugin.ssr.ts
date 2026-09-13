import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { createToggly, TOGGLY_INJECTION_KEY, vFeature, vFeatureShow, vFeatureClass } from '@ops-ai/nuxt-toggly-client'
import type { ModuleOptions } from '../module/types'

export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig().public.toggly as ModuleOptions
  const resolveSnapshot = config.ssr !== false
    ? nuxtApp.ssrContext?.event.context.togglySsrSnapshot
    : undefined
  // Only evaluated booleans cross the payload boundary; never raw definitions.
  const snapshot = resolveSnapshot
    ? await resolveSnapshot()
    : { features: { ...config.featureDefaults }, identity: config.identity }
  const features = snapshot.features
  nuxtApp.payload.toggly = snapshot
  const toggly = createToggly({
    featureDefaults: features,
    identity: snapshot.identity,
    refreshInterval: 0,
    enableLiveUpdates: false,
    persistIdentity: false,
    persistFeatures: false,
  })
  toggly.isReady.value = true
  nuxtApp.vueApp.provide(TOGGLY_INJECTION_KEY, toggly)
  if (config.globalDirectives !== false) {
    nuxtApp.vueApp.directive('feature', vFeature)
    nuxtApp.vueApp.directive('feature-show', vFeatureShow)
    nuxtApp.vueApp.directive('feature-class', vFeatureClass)
  }
  nuxtApp.hook('app:rendered', () => toggly.client.destroy())
  return { provide: { toggly } }
})
