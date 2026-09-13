import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { derSignatureToP1363, verifySignedDefinitions, type JwkSet } from './signed-defs-verify'

type WebCryptoFixture = {
  defs: string
  timestamp: number
  signature: string
  kid: string
  jwks: JwkSet
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'webcrypto-fixture.json'),
    'utf8'
  )
) as WebCryptoFixture

describe('canonical WebCrypto signed-definitions fixture', () => {
  it('verifies the canonical Worker-compatible signature', async () => {
    await expect(
      verifySignedDefinitions(fixture.defs, fixture, fixture.jwks)
    ).resolves.toBeUndefined()
  })

  it('rejects a signature when the signed defs change', async () => {
    await expect(
      verifySignedDefinitions(
        fixture.defs.replace('true', 'false'),
        fixture,
        fixture.jwks
      )
    ).rejects.toThrow(/invalid signature/)
  })

  it('rejects a malformed signature encoding', async () => {
    await expect(
      verifySignedDefinitions(
        fixture.defs,
        { ...fixture, signature: '@@not-base64@@' },
        fixture.jwks
      )
    ).rejects.toThrow()
  })
})

const derCases = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'der-signatures.json'),
    'utf8'
  )
) as { valid: string; invalid: Record<string, string> }

describe('DER signature validation', () => {
  it('accepts canonical DER and recovers the original P1363 bytes', async () => {
    expect(derSignatureToP1363(Buffer.from(derCases.valid, 'base64'))).toEqual(
      Uint8Array.from(Buffer.from(fixture.signature, 'base64'))
    )
    await expect(
      verifySignedDefinitions(fixture.defs, { ...fixture, signature: derCases.valid }, fixture.jwks)
    ).resolves.toBeUndefined()
  })

  for (const [name, signature] of Object.entries(derCases.invalid)) {
    it(`rejects ${name} in the DER decoder`, () => {
      expect(() => derSignatureToP1363(Buffer.from(signature, 'base64'))).toThrow(/DER/)
    })
    it(`rejects ${name} during verification`, async () => {
      await expect(
        verifySignedDefinitions(fixture.defs, { ...fixture, signature }, fixture.jwks)
      ).rejects.toThrow()
    })
  }
})
