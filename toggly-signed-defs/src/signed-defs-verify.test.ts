import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { verifySignedDefinitions, type JwkSet } from './signed-defs-verify'

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
