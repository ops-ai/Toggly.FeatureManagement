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

/** Unwrap `{ defs }` when present; otherwise treat payload as the defs map. */
export function unwrapDefsPayload(payload: unknown): unknown {
  if (typeof payload === 'object' && payload !== null && 'defs' in payload) {
    const defs = (payload as { defs?: unknown }).defs
    if (defs !== undefined) {
      return defs
    }
  }
  return payload
}

export type { EvaluatedDefinitions, EvaluatedDefinitionValue, EntityGate, EntityGateRule } from './evaluated-definitions'
