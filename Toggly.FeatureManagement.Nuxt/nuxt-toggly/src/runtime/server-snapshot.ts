import { getServerToggly, resolveEventEvalContext, toEvalOverrides } from '@ops-ai/nuxt-toggly-server'
import type { ModuleOptions } from '../module/types'

export async function createServerSnapshot(event: Parameters<typeof resolveEventEvalContext>[0], config: ModuleOptions) {
  const server = getServerToggly()
  const context = await resolveEventEvalContext(event)
  const features = { ...config.featureDefaults }
  if (server) {
    const keys = new Set([...Object.keys(server.state.features), ...server.getDefinitions().keys()])
    await Promise.all([...keys].map(async key => {
      features[key] = await server.isFeatureOn(key, undefined, undefined, toEvalOverrides(context))
    }))
  }
  return { features, identity: context.identity ?? config.identity }
}
