import type { FeatureDefinitions, FeatureDefinitionsResponse } from './types'

function isBooleanFeatureMap(data: object): data is FeatureDefinitions {
  return Object.values(data).every((value) => typeof value === 'boolean')
}

function isDefinitionArray(
  data: unknown,
): data is Array<{ featureKey: string; filters?: Array<{ name?: string }> }> {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof (item as { featureKey?: unknown }).featureKey === 'string',
    )
  )
}

function fromDefinitionArray(
  data: Array<{ featureKey: string; filters?: Array<{ name?: string }> }>,
): FeatureDefinitions {
  const definitions: FeatureDefinitions = {}
  for (const definition of data) {
    definitions[definition.featureKey] = !!definition.filters?.some(
      (filter) => filter.name === 'AlwaysOn',
    )
  }
  return definitions
}

/**
 * Parse an evaluated-signed HTTP body into a boolean feature map.
 * Throws when the body is an error envelope or otherwise unsupported so callers
 * cannot treat empty/bogus payloads as a successful definitions fetch.
 */
export function parseRemoteEvaluatedPayload(
  parsed: unknown,
  options: { verifySignatures?: boolean } = {},
): FeatureDefinitions {
  if (isDefinitionArray(parsed)) {
    return fromDefinitionArray(parsed)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      '[Toggly] Unsupported evaluated-signed response: expected defs, features, or a boolean map',
    )
  }

  const data = parsed as FeatureDefinitionsResponse &
    FeatureDefinitions & { error?: unknown }

  if (
    'error' in data &&
    data.error != null &&
    !('defs' in data && data.defs) &&
    !('features' in data && Array.isArray(data.features))
  ) {
    const message =
      typeof data.error === 'string' ? data.error : 'error envelope'
    throw new Error(
      `[Toggly] Evaluated-signed response error envelope: ${message}`,
    )
  }

  if ('defs' in data && data.defs && typeof data.defs === 'object') {
    return { ...data.defs }
  }

  if ('features' in data && Array.isArray(data.features)) {
    const definitions: FeatureDefinitions = {}
    for (const feature of data.features) {
      definitions[feature.featureKey] = feature.enabled
    }
    return definitions
  }

  // Verified or bare boolean maps (including empty {}).
  if (isBooleanFeatureMap(data)) {
    return { ...data }
  }

  if (options.verifySignatures) {
    throw new Error(
      '[Toggly] Unsupported verified evaluated-signed payload: expected a boolean feature map or definition array',
    )
  }

  throw new Error(
    '[Toggly] Unsupported evaluated-signed response: expected defs, features, or a boolean map',
  )
}
