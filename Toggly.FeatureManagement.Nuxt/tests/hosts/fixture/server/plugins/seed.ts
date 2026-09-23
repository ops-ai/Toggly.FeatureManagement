import { initServerToggly, closeServerToggly } from '@ops-ai/nuxt-toggly-server'

export default defineNitroPlugin(async nitro => {
  // The runtime-policy host must exercise the module initializer itself.
  if (process.env.NUXT_TEST_MODULE_POLICY === '1') return
  // Deterministic in-memory fixture; signature verification is covered by core tests.
  const client = await initServerToggly({ identity: 'server-default', enableUsageTracking: false, enableMetrics: false, enableLiveUpdates: false })
  client.hydrateDefinitions([
    { featureKey: 'Enabled', filters: [{ name: 'AlwaysOn', parameters: {} }] },
    { featureKey: 'Disabled', filters: [] },
    { featureKey: 'Targeted', filters: [{ name: 'Targeting', parameters: { 'Audience.Users:0': 'alice', 'Audience.DefaultRolloutPercentage': 0 } }] },
  ])
  nitro.hooks.hook('close', closeServerToggly)
})
