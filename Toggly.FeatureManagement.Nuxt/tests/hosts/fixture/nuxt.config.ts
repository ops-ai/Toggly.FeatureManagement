export default defineNuxtConfig({
  modules: ['@ops-ai/nuxt-toggly'],
  compatibilityDate: '2026-09-12',
  devtools: { enabled: false },
  toggly: {
    appKey: '',
    baseUri: 'http://127.0.0.1',
    ssr: true,
    featureDefaults: { Enabled: true, Disabled: false },
    identity: 'anonymous',
    groups: ['fixture'],
    claims: { plan: 'fixture' },
    persistIdentity: false,
    refreshInterval: 0,
    enableLiveUpdates: false,
  },
})
