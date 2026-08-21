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
  allowedKeyIds?: string[]
  maxSignatureAgeSeconds?: number
  headers?: HeadersInit
  /** Optional fetch override (tests / Docusaurus). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

function resolveBaseUri(options: VerifySignatureOptions): string {
  const base = options.baseURI ?? options.baseUri
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
  const jwks = await fetchJwks(
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
