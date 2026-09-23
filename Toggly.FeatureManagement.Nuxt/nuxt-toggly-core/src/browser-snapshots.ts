import { isEntityGate } from '@ops-ai/toggly-hooks-types'
import type { EvaluatedVariantDef, FeatureDefinitions, TogglyConfig } from './types'
import type { FeatureDefinitionModel } from '@ops-ai/toggly-eval'
export interface BrowserSnapshot {
  features: FeatureDefinitions
  definitions: FeatureDefinitionModel[]
  variants: Record<string, EvaluatedVariantDef> | null
  revision: string | null
}
/** Each validator travels with its response body, mode and targeting context. */
export function createBrowserSnapshots(config: TogglyConfig) {
  const memory = new Map<string, BrowserSnapshot>()
  const route = () => JSON.stringify([config.baseUri, config.appKey, config.environment, config.evaluationMode ?? 'remote', config.enableVariants ?? false])
  const scope = () => JSON.stringify([route(), config.instanceId?.trim() ? ['i', config.instanceId.trim()]
    : ['u', config.identity ?? '', [...(config.groups ?? [])].sort((a,b)=>a<b?-1:a>b?1:0), Object.entries(config.claims ?? {}).sort(([a],[b])=>a.localeCompare(b))]])
  const key = () => `${config.featuresStorageKey ?? 'toggly:features'}:v2:${encodeURIComponent(route())}`
  function persisted() {
    const entries = new Map<string, BrowserSnapshot>()
    if (!config.persistFeatures) return entries
    try {
      if (typeof localStorage === 'undefined') return entries
      const values: unknown = JSON.parse(localStorage.getItem(key()) ?? 'null')
      if (Array.isArray(values)) for (const entry of values.slice(-8)) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue
        const value = entry[1]
        if (value?.features && typeof value.features === 'object' && !Array.isArray(value.features)
          && Object.values(value.features).every(flag => typeof flag === 'boolean' || (isEntityGate(flag)
            && flag.rules.every(rule => rule !== null && typeof rule === 'object'
              && typeof rule.property === 'string' && typeof rule.op === 'string' && typeof rule.value === 'string'
              && (rule.type === undefined || ['datetime','number','boolean','string','string[]'].includes(rule.type)))))
          && Array.isArray(value.definitions) && value.definitions.every((def: FeatureDefinitionModel)=>typeof def?.featureKey==='string')
          && (value.variants === undefined || value.variants === null || (typeof value.variants === 'object' && !Array.isArray(value.variants)
            && Object.values(value.variants).every((entry) => {
              const def = entry as EvaluatedVariantDef
              return def !== null && typeof def === 'object'
                && typeof def.enabled === 'boolean' && (def.variant === undefined || typeof def.variant === 'string')
            })))
          && (value.revision === null || typeof value.revision === 'string')) entries.set(entry[0], {...value, variants: value.variants ?? null})
      }
    } catch { /* Optional storage may be unavailable or corrupt. */ }
    return entries
  }
  function put(map: Map<string, BrowserSnapshot>, value: BrowserSnapshot) {
    map.delete(scope()); map.set(scope(), value)
    if (map.size > 8) map.delete(map.keys().next().value!)
  }
  return {
    scope,
    restore: () => memory.get(scope()) ?? persisted().get(scope()),
    save(value: BrowserSnapshot) {
      put(memory, value)
      if (config.persistFeatures) try {
        if (typeof localStorage === 'undefined') return
        const entries = persisted(); put(entries, value)
        localStorage.setItem(key(), JSON.stringify([...entries]))
      } catch { /* Optional storage may be unavailable or full. */ }
    },
  }
}
