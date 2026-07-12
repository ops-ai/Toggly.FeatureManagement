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
 * Extract the exact raw JSON text of a top-level property without re-serializing.
 */
export function extractRawJsonProperty(text: string, key: string): string | null {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*`)
  const match = keyPattern.exec(text)
  if (!match) {
    return null
  }

  let i = match.index + match[0].length
  while (i < text.length && /\s/.test(text[i]!)) {
    i += 1
  }
  if (i >= text.length) {
    return null
  }

  const start = i
  const first = text[i]!

  if (first === '{' || first === '[') {
    let depth = 0
    let inString = false
    let escape = false
    for (let j = i; j < text.length; j++) {
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
    let escape = false
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j]!
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === '"') {
        return text.slice(start, j + 1)
      }
    }
    return null
  }

  // number / true / false / null
  let j = i
  while (j < text.length && /[^\s,\}\]]/.test(text[j]!)) {
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
    typeof parsed.kid !== 'string' ||
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
 */
export function verifySignedDefinitions(
  defsRaw: string,
  envelope: Pick<SignedEnvelope, 'signature' | 'timestamp' | 'kid'>,
  jwks: JwkSet,
  allowedKids?: ReadonlySet<string> | string[] | null
): void {
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
