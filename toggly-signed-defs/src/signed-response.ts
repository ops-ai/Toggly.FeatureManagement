/**
 * Shared helpers for parsing evaluated-signed API responses.
 * When verifySignatures is enabled, verifies the ES256 envelope before applying defs.
 */

import {
  parseSignedEnvelope,
  verifySignedDefinitions,
  parseDefinitionsFromRaw,
  type JwkSet,
} from './signed-defs-verify'

export interface VerifySignatureOptions {
  verifySignatures?: boolean
  /** Preferred base URL field (Astro / Gatsby / Nuxt / Remix / Docusaurus). */
  baseURI?: string
  /** Alias used by Next.js packages. */
  baseUri?: string
  /** Alias used by Remix and some server clients. */
  baseUrl?: string
  allowedKeyIds?: string[]
  maxSignatureAgeSeconds?: number
  headers?: HeadersInit
  /** Optional fetch override (tests / Docusaurus). Defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Optional JWKS provider (in-memory cache). Defaults to a one-shot JWKS fetch. */
  getJwks?: () => Promise<JwkSet>
}

function resolveBaseUri(options: VerifySignatureOptions): string {
  const base = options.baseURI ?? options.baseUri ?? options.baseUrl
  if (!base) {
    throw new Error('baseURI (or baseUri) is required when verifySignatures is enabled')
  }
  return base
}

async function fetchJwks(
  baseUri: string,
  headers?: HeadersInit,
  fetchImpl: typeof fetch = fetch
): Promise<JwkSet> {
  const base = baseUri.replace(/\/$/, '')
  const response = await fetchImpl(`${base}/.well-known/jwks`, {
    method: 'GET',
    headers,
  })
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: HTTP ${response.status}`)
  }
  return (await response.json()) as JwkSet
}

/**
 * Read response body as text (prefer text() for raw-defs verification).
 */
export async function readResponseBody(response: Response): Promise<string> {
  if (typeof response.text === 'function') {
    return response.text()
  }
  return JSON.stringify(await response.json())
}

/**
 * Parse an evaluated-signed body.
 * With verifySignatures: verify envelope and return parsed defs (never envelope.defs).
 * Without: JSON.parse as today (may be `{ defs }` or a bare map).
 */
export async function parseEvaluatedResponseBody(
  bodyText: string,
  options: VerifySignatureOptions
): Promise<unknown> {
  if (!options.verifySignatures) {
    return JSON.parse(bodyText) as unknown
  }

  const { envelope, defsRaw } = parseSignedEnvelope(bodyText)
  const jwks = options.getJwks
    ? await options.getJwks()
    : await fetchJwks(
        resolveBaseUri(options),
        options.headers,
        options.fetchImpl ?? fetch
      )
  await verifySignedDefinitions(
    defsRaw,
    {
      signature: envelope.signature,
      timestamp: envelope.timestamp,
      kid: envelope.kid,
    },
    jwks,
    options.allowedKeyIds,
    options.maxSignatureAgeSeconds != null
      ? { maxSignatureAgeSeconds: options.maxSignatureAgeSeconds }
      : null
  )
  return parseDefinitionsFromRaw(defsRaw)
}

/** In-memory JWKS cache used by client SDKs across refreshes. */
export class InMemoryJwksCache {
  private jwks: JwkSet | null = null

  clear(): void {
    this.jwks = null
  }

  async get(options: VerifySignatureOptions, forceRefresh = false): Promise<JwkSet> {
    if (!forceRefresh && this.jwks) {
      return this.jwks
    }
    this.jwks = await fetchJwks(
      resolveBaseUri(options),
      options.headers,
      options.fetchImpl ?? fetch
    )
    return this.jwks
  }
}

/**
 * Read an evaluated-signed HTTP body and return unwrapped defs.
 * Unsigned payloads may be `{ defs }` or a bare map; signed payloads are verified first.
 */
export async function readAndParseEvaluatedResponse(
  response: Response,
  options: VerifySignatureOptions
): Promise<unknown> {
  const parsed = await parseEvaluatedResponseBody(await readResponseBody(response), options)
  return options.verifySignatures ? parsed : unwrapDefsPayload(parsed)
}

/**
 * Parse an evaluated-signed response using an in-memory JWKS cache.
 * Client SDKs pass their existing config object plus optional fetch headers.
 */
export async function readAndParseEvaluatedResponseCached(
  response: Response,
  jwks: InMemoryJwksCache,
  config: {
    verifySignatures?: boolean
    baseURI?: string
    baseUri?: string
    baseUrl?: string
    allowedKeyIds?: string[]
    maxSignatureAgeSeconds?: number | null
    fetchImpl?: typeof fetch
  },
  headers?: HeadersInit
): Promise<unknown> {
  return readAndParseEvaluatedResponse(
    response,
    signedDefsClientOptions(
      {
        verifySignatures: config.verifySignatures,
        baseURI: config.baseURI,
        baseUri: config.baseUri ?? config.baseUrl,
        allowedKeyIds: config.allowedKeyIds,
        maxSignatureAgeSeconds: config.maxSignatureAgeSeconds,
        headers,
        fetchImpl: config.fetchImpl,
      },
      jwks
    )
  )
}

const DEFINITIONS_REVISION_HEADER = 'X-Definitions-Revision'

export type EvaluatedSignedFetchConfig = {
  verifySignatures?: boolean
  baseURI?: string
  baseUri?: string
  baseUrl?: string
  allowedKeyIds?: string[]
  maxSignatureAgeSeconds?: number | null
  fetchImpl?: typeof fetch
}

export type EvaluatedSignedFetchResult =
  | { notModified: true; revision: string | null }
  | { notModified: false; defs: unknown; revision: string | null }

function revisionFromResponse(response: Response): string | null {
  const headers = response.headers
  if (!headers || typeof headers.get !== 'function') {
    return null
  }
  return headers.get(DEFINITIONS_REVISION_HEADER) ?? headers.get('ETag')
}

function asHeaderRecord(init?: HeadersInit): Record<string, string> {
  if (!init) {
    return {}
  }
  if (Array.isArray(init)) {
    return Object.fromEntries(init)
  }
  if (typeof (init as Headers).forEach === 'function') {
    const record: Record<string, string> = {}
    ;(init as Headers).forEach((value, key) => {
      record[key] = value
    })
    return record
  }
  const record: Record<string, string> = {}
  for (const [key, value] of Object.entries(init as Record<string, unknown>)) {
    if (typeof value === 'string') {
      record[key] = value
    }
  }
  return record
}

/**
 * Fetch evaluated-signed defs, honor If-None-Match / 304, and parse through the JWKS cache.
 */
export async function fetchEvaluatedSignedDefinitions(
  url: string,
  jwks: InMemoryJwksCache,
  config: EvaluatedSignedFetchConfig,
  request: { revision?: string | null; headers?: HeadersInit } = {}
): Promise<EvaluatedSignedFetchResult> {
  const fetchImpl = config.fetchImpl ?? fetch
  const headers = asHeaderRecord(request.headers)
  if (request.revision) {
    headers['If-None-Match'] = request.revision
  }
  const response = await fetchImpl(url, { headers })
  const revision = revisionFromResponse(response)
  if (response.status === 304) {
    return { notModified: true, revision }
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch feature flags: ${response.status} ${response.statusText}`)
  }
  const defs = await readAndParseEvaluatedResponseCached(response, jwks, config, request.headers)
  return { notModified: false, defs, revision }
}

/** Build parse options that reuse an in-memory JWKS cache. */
export function signedDefsClientOptions(
  config: Omit<
    Pick<
      VerifySignatureOptions,
      | 'verifySignatures'
      | 'baseURI'
      | 'baseUri'
      | 'baseUrl'
      | 'allowedKeyIds'
      | 'maxSignatureAgeSeconds'
      | 'headers'
      | 'fetchImpl'
    >,
    'maxSignatureAgeSeconds'
  > & { maxSignatureAgeSeconds?: number | null },
  jwks: InMemoryJwksCache
): VerifySignatureOptions {
  const baseURI = config.baseURI ?? config.baseUri ?? config.baseUrl
  return {
    ...config,
    baseURI,
    maxSignatureAgeSeconds: config.maxSignatureAgeSeconds ?? undefined,
    getJwks: () =>
      jwks.get({
        baseURI,
        headers: config.headers,
        fetchImpl: config.fetchImpl,
      }),
  }
}

/**
 * Reject HTTP 2xx bodies whose primary payload is an error envelope without
 * defs or features. Mirrors nextjs-toggly-core parseRemoteEvaluatedPayload.
 */
export function rejectEvaluatedErrorEnvelope(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return
  }

  const data = payload as Record<string, unknown>
  const hasDefs =
    'defs' in data && data.defs != null && typeof data.defs === 'object'
  const hasFeatures = 'features' in data && Array.isArray(data.features)

  if ('error' in data && data.error != null && !hasDefs && !hasFeatures) {
    const message =
      typeof data.error === 'string' ? data.error : 'error envelope'
    throw new Error(
      `[Toggly] Evaluated-signed response error envelope: ${message}`,
    )
  }
}

/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export function unwrapDefsPayload(payload: unknown): unknown {
  rejectEvaluatedErrorEnvelope(payload)

  if (typeof payload === 'object' && payload !== null && 'defs' in payload) {
    const defs = (payload as { defs?: unknown }).defs
    if (defs !== undefined) {
      return defs
    }
  }
  return payload
}

/** Coerce evaluated-variants payload to a defs map; arrays/primitives become `{}`. */
export function asVariantDefsRecord<T>(parsedDefs: unknown): Record<string, T> {
  rejectEvaluatedErrorEnvelope(parsedDefs)

  if (parsedDefs && typeof parsedDefs === 'object' && !Array.isArray(parsedDefs)) {
    return parsedDefs as Record<string, T>
  }
  return {}
}

export type EvaluatedFetchErrorRecovery<TFlags, TVariants> = {
  variants: TVariants | null
  features: TFlags
}

/**
 * Shared fallback when evaluated-signed fetch fails: prefer cached variants,
 * else flags/defaults when features were never loaded. Returns null to keep
 * in-memory state unchanged.
 */
export function resolveEvaluatedFetchErrorState<TFlags, TVariants>(input: {
  enableVariants: boolean
  featuresAlreadyLoaded: boolean
  readVariants: () => TVariants | null | undefined
  readFlags: () => TFlags | null | undefined
  defaults: TFlags
  variantsToFlags: (variants: TVariants) => TFlags
}): EvaluatedFetchErrorRecovery<TFlags, TVariants> | null {
  if (input.enableVariants) {
    const cachedVariants = input.readVariants() ?? null
    if (cachedVariants) {
      return {
        variants: cachedVariants,
        features: input.variantsToFlags(cachedVariants),
      }
    }
    if (!input.featuresAlreadyLoaded) {
      return { variants: null, features: input.readFlags() ?? input.defaults }
    }
    return null
  }
  if (!input.featuresAlreadyLoaded) {
    return { variants: null, features: input.readFlags() ?? input.defaults }
  }
  return null
}

export type { EvaluatedDefinitions, EvaluatedDefinitionValue, EntityGate, EntityGateRule } from './evaluated-definitions'
