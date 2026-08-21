/**
 * Signed definitions verification (ES256).
 *
 * Matches Go toggly/crypto/verify.go:
 * payload = exact raw defs JSON bytes + "|" + timestamp
 * digest  = SHA-256(SHA-256(payload))
 * verify  = ECDSA P-256 (IEEE P1363 or DER)
 */

import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto'

/**
 * Envelope timestamp freshness checks for signed definitions.
 *
 * Timestamps are Unix seconds (same units as Definitions `evaluated-signed`).
 * When `maxSignatureAgeSeconds` is unset or <= 0, freshness is not enforced
 * (back-compat). Clock skew allows a small future window for client clocks.
 */
export interface VerifyFreshnessOptions {
  /** Reject envelopes older than this many seconds. Omit / <=0 = disabled. */
  maxSignatureAgeSeconds?: number | null
  /** Allowed future skew in seconds (default 60). */
  maxClockSkewSeconds?: number
  /** Override "now" for tests (Unix seconds). */
  nowSeconds?: number
}

export function assertEnvelopeFreshness(
  timestamp: number,
  options?: VerifyFreshnessOptions | null
): void {
  const maxAge = options?.maxSignatureAgeSeconds
  if (maxAge == null || maxAge <= 0) {
    return
  }
  if (!Number.isFinite(timestamp)) {
    throw new Error('invalid signature timestamp')
  }
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000)
  const skew = options?.maxClockSkewSeconds ?? 60
  if (timestamp > now + skew) {
    throw new Error('signature timestamp is in the future')
  }
  if (now - timestamp > maxAge) {
    throw new Error('signature timestamp exceeded maxSignatureAgeSeconds')
  }
}

export interface SignedEnvelope {
  defs: unknown
  signature: string
  timestamp: number
  kid: string
}

export interface Jwk {
  kty: string
  use?: string
  kid: string
  crv?: string
  x?: string
  y?: string
  alg?: string
  exp?: number
}

export interface JwkSet {
  keys: Jwk[]
}

/**
 * Extract the exact raw JSON text of a **top-level** property only.
 * Nested keys (e.g. data.defs) are ignored so unsigned outer fields cannot
 * be swapped in after verifying nested signed bytes.
 */
export function extractRawJsonProperty(text: string, key: string): string | null {
  let index = 0
  let depth = 0
  let inString = false
  let escape = false

  while (index < text.length) {
    const character = text[index]!
    if (inString) {
      if (escape) {
        escape = false
      } else if (character === '\\') {
        escape = true
      } else if (character === '"') {
        inString = false
      }
      index += 1
      continue
    }

    if (character === '"') {
      if (depth === 1) {
        const keyEnd = findStringEnd(text, index)
        if (keyEnd == null) {
          return null
        }
        const propertyName = text.slice(index + 1, keyEnd)
        let valueStart = keyEnd + 1
        while (valueStart < text.length && /\s/.test(text[valueStart]!)) {
          valueStart += 1
        }
        if (propertyName === key && valueStart < text.length && text[valueStart] === ':') {
          valueStart += 1
          while (valueStart < text.length && /\s/.test(text[valueStart]!)) {
            valueStart += 1
          }
          return extractJsonValue(text, valueStart)
        }
        index = keyEnd + 1
        continue
      }
      inString = true
      index += 1
      continue
    }

    if (character === '{' || character === '[') {
      depth += 1
    } else if (character === '}' || character === ']') {
      depth -= 1
    }
    index += 1
  }

  return null
}

function findStringEnd(text: string, startQuote: number): number | null {
  let escape = false
  for (let i = startQuote + 1; i < text.length; i++) {
    const c = text[i]!
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\') {
      escape = true
      continue
    }
    if (c === '"') {
      return i
    }
  }
  return null
}

function extractJsonValue(text: string, start: number): string | null {
  if (start >= text.length) {
    return null
  }

  const first = text[start]!
  if (first === '{' || first === '[') {
    let depth = 0
    let inString = false
    let escape = false
    for (let j = start; j < text.length; j++) {
      const c = text[j]!
      if (inString) {
        if (escape) {
          escape = false
        } else if (c === '\\') {
          escape = true
        } else if (c === '"') {
          inString = false
        }
        continue
      }
      if (c === '"') {
        inString = true
      } else if (c === '{' || c === '[') {
        depth += 1
      } else if (c === '}' || c === ']') {
        depth -= 1
        if (depth === 0) {
          return text.slice(start, j + 1)
        }
      }
    }
    return null
  }

  if (first === '"') {
    const end = findStringEnd(text, start)
    return end == null ? null : text.slice(start, end + 1)
  }

  let j = start
  while (j < text.length && /[^\s,}\]]/.test(text[j]!)) {
    j += 1
  }
  return text.slice(start, j)
}

export function parseSignedEnvelope(bodyText: string): {
  envelope: SignedEnvelope
  defsRaw: string
} {
  const parsed = JSON.parse(bodyText) as SignedEnvelope
  if (
    parsed == null ||
    typeof parsed !== 'object' ||
    typeof parsed.signature !== 'string' ||
    parsed.signature.length === 0 ||
    typeof parsed.kid !== 'string' ||
    parsed.kid.length === 0 ||
    typeof parsed.timestamp !== 'number'
  ) {
    throw new Error('Invalid signed definitions envelope')
  }

  const defsRaw = extractRawJsonProperty(bodyText, 'defs')
  if (!defsRaw) {
    throw new Error('Signed envelope missing defs')
  }

  return { envelope: parsed, defsRaw }
}

/** Parse the verified raw defs JSON — never use envelope.defs after verify. */
export function parseDefinitionsFromRaw(defsRaw: string): unknown {
  return JSON.parse(defsRaw)
}

function doubleSha256(payload: string): Buffer {
  const first = createHash('sha256').update(payload, 'utf8').digest()
  return createHash('sha256').update(first).digest()
}

function padBase64Url(value: string): string {
  const remainder = value.length % 4
  if (remainder === 0) return value
  return value + '='.repeat(4 - remainder)
}

function computeKid(x: string, y: string): string {
  const xBytes = Buffer.from(padBase64Url(x), 'base64url')
  const yBytes = Buffer.from(padBase64Url(y), 'base64url')
  const digest = createHash('sha1').update(xBytes).update(yBytes).digest('hex').toUpperCase()
  return `${digest}ES256`
}

export function validateAndParseEs256Key(
  jwk: Jwk,
  allowedKids?: ReadonlySet<string> | string[] | null
): KeyObject {
  if (jwk.alg !== 'ES256') {
    throw new Error(`unsupported alg: ${jwk.alg ?? ''}`)
  }
  if (jwk.crv !== 'P-256') {
    throw new Error(`unsupported crv: ${jwk.crv ?? ''}`)
  }
  if (!jwk.x || !jwk.y) {
    throw new Error('missing x or y coordinate')
  }

  if (allowedKids) {
    const set = allowedKids instanceof Set ? allowedKids : new Set(allowedKids)
    if (set.size > 0 && !set.has(jwk.kid)) {
      throw new Error(`kid not allowed: ${jwk.kid}`)
    }
  }

  const expected = computeKid(jwk.x, jwk.y)
  if (jwk.kid !== expected) {
    throw new Error(`invalid kid: expected ${expected}, got ${jwk.kid}`)
  }

  return createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: jwk.x,
      y: jwk.y,
    } as JsonWebKey,
    format: 'jwk',
  })
}

/**
 * Verify a signed definitions / evaluated-signed envelope using raw defs bytes.
 *
 * After a successful verify, callers MUST apply `parseDefinitionsFromRaw(defsRaw)`
 * — never `envelope.defs` from JSON.parse of the outer body.
 */
export function verifySignedDefinitions(
  defsRaw: string,
  envelope: Pick<SignedEnvelope, 'signature' | 'timestamp' | 'kid'>,
  jwks: JwkSet,
  allowedKids?: ReadonlySet<string> | string[] | null,
  freshness?: VerifyFreshnessOptions | null
): void {
  assertEnvelopeFreshness(envelope.timestamp, freshness)

  const matching = jwks.keys.find((k) => k.kid === envelope.kid)
  if (!matching) {
    throw new Error(`no matching jwk for kid "${envelope.kid}"`)
  }

  const key = validateAndParseEs256Key(matching, allowedKids)
  const payload = `${defsRaw}|${envelope.timestamp}`
  const hash = doubleSha256(payload)
  const signature = Buffer.from(envelope.signature, 'base64')

  const encoding = signature.length === 64 ? 'ieee-p1363' : 'der'
  const ok = cryptoVerify(
    null,
    hash,
    {
      key,
      dsaEncoding: encoding,
    },
    signature
  )

  if (!ok) {
    throw new Error('invalid signature')
  }
}
