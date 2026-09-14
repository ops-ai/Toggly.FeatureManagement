import { useRuntimeConfig } from '#imports'
import { createServerSnapshot } from './server-snapshot'
import type { ModuleOptions } from '../module/types'

export default function (event: Parameters<typeof createServerSnapshot>[0]) {
  // Resolve after application middleware has attached authenticated context.
  // An H3 middleware also works on Nitro 1, which predates the request hook.
  const config = useRuntimeConfig().public.toggly as ModuleOptions
  event.context.togglySsrSnapshot = () => createServerSnapshot(event, config)
}
