import {
  registerContext as registerEntityContextMapper,
  type TogglyEntityContext,
} from '@ops-ai/toggly-hooks-types'

export interface EntityContextPropertySchema {
  name: string
  type: string
}

export interface EntityContextSchemaRegistration {
  kind: string
  keyProperty: string
  displayName?: string
  properties: EntityContextPropertySchema[]
}

const schemaRegistrations = new Map<string, EntityContextSchemaRegistration>()

export function registerEntityContextSchema(
  registration: EntityContextSchemaRegistration,
): void {
  schemaRegistrations.set(registration.kind, registration)
}

export function registerContext<T>(
  kind: string,
  mapper: (entity: T) => TogglyEntityContext,
  schema?: Omit<EntityContextSchemaRegistration, 'kind'>,
): void {
  registerEntityContextMapper(kind, mapper)
  if (schema) {
    registerEntityContextSchema({
      kind,
      keyProperty: schema.keyProperty,
      displayName: schema.displayName ?? kind,
      properties: schema.properties,
    })
  }
}

export function getEntityContextSchemaRegistrations(): EntityContextSchemaRegistration[] {
  return [...schemaRegistrations.values()]
}

export async function registerEntityContextsAtStartup(options: {
  baseUrl: string
  appKey: string
  registerOnStartup?: boolean
  debug?: boolean
  timeout?: number
}): Promise<void> {
  if (options.registerOnStartup === false) {
    return
  }

  if (!options.appKey) {
    return
  }

  const registrations = getEntityContextSchemaRegistrations()
  if (registrations.length === 0) {
    return
  }

  const payload = {
    contexts: registrations.map((registration) => ({
      kind: registration.kind,
      keyProperty: registration.keyProperty,
      displayName: registration.displayName ?? registration.kind,
      properties: registration.properties.map((property) => ({
        name: property.name,
        type: property.type,
      })),
    })),
  }

  const url = new URL(`sdk/${options.appKey}/contexts`, options.baseUrl)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 10000)

  try {
    const response = await fetch(url.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (options.debug) {
      if (response.ok) {
        console.debug(
          `[Toggly] Registered ${payload.contexts.length} entity context kind(s) at startup.`,
        )
      } else {
        console.warn(
          `[Toggly] Entity context registration returned HTTP ${response.status}. Dashboard catalog was not updated.`,
        )
      }
    }
  } catch (error) {
    if (options.debug) {
      console.warn('[Toggly] Entity context registration failed.', error)
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export function clearEntityContextSchemaRegistrations(): void {
  schemaRegistrations.clear()
}
