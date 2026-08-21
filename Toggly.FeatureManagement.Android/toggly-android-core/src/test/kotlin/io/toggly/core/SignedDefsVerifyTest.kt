package io.toggly.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class SignedDefsVerifyTest {
    @Test
    fun `accepts double hash P1363 signatures over raw defs`() {
        val key = createKey()
        val defs = """{"PresalePhotos":true,"PuppySales":false}"""
        val timestamp = 1_783_915_396L
        val signature = signP1363(key, SignedDefsVerify.doubleSha256("$defs|$timestamp"))
        val body = """{"defs":$defs,"signature":"${base64(signature)}","timestamp":$timestamp,"kid":"${key.kid}"}"""

        val envelope = SignedDefsVerify.parseSignedEnvelope(body)
        SignedDefsVerify.verify(envelope, jwks(key))

        assertEquals(defs, envelope.defsRaw)
        assertEquals(mapOf("PresalePhotos" to true, "PuppySales" to false), SignedDefsVerify.parseDefinitions(defs))
    }

    @Test
    fun `rejects single hash signatures`() {
        val key = createKey()
        val defs = """{"PresalePhotos":true}"""
        val timestamp = 1_783_915_396L
        val singleHash = MessageDigest.getInstance("SHA-256").digest("$defs|$timestamp".toByteArray())
        val envelope = SignedDefsVerify.SignedEnvelope(
            defsRaw = defs,
            signature = base64(signP1363(key, singleHash)),
            timestamp = timestamp,
            kid = key.kid
        )

        assertThrows(IllegalArgumentException::class.java) {
            SignedDefsVerify.verify(envelope, jwks(key))
        }
    }

    @Test
    fun `rejects reserialized or pretty printed defs`() {
        val key = createKey()
        val rawDefs = """{"feature-a":true,"feature-b":false}"""
        val prettyDefs = """
            {
              "feature-a": true,
              "feature-b": false
            }
        """.trimIndent()
        val timestamp = 42L
        val envelope = SignedDefsVerify.SignedEnvelope(
            defsRaw = prettyDefs,
            signature = base64(signP1363(key, SignedDefsVerify.doubleSha256("$rawDefs|$timestamp"))),
            timestamp = timestamp,
            kid = key.kid
        )

        assertThrows(IllegalArgumentException::class.java) {
            SignedDefsVerify.verify(envelope, jwks(key))
        }
    }

    @Test
    fun `accepts DER signatures as a fallback`() {
        val key = createKey()
        val defs = """{"feature-a":true}"""
        val timestamp = 42L
        val digest = SignedDefsVerify.doubleSha256("$defs|$timestamp")
        val signer = Signature.getInstance("NONEwithECDSA")
        signer.initSign(key.pair.private)
        signer.update(digest)
        val envelope = SignedDefsVerify.SignedEnvelope(
            defsRaw = defs,
            signature = base64(signer.sign()),
            timestamp = timestamp,
            kid = key.kid
        )

        SignedDefsVerify.verify(envelope, jwks(key))
    }

    @Test
    fun `rejects empty signature or kid`() {
        assertThrows(IllegalArgumentException::class.java) {
            SignedDefsVerify.parseSignedEnvelope(
                """{"defs":{"a":1},"signature":"","timestamp":1,"kid":"k"}"""
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            SignedDefsVerify.parseSignedEnvelope(
                """{"defs":{"a":1},"signature":"x","timestamp":1,"kid":""}"""
            )
        }
    }

    @Test
    fun `assertEnvelopeFreshness no-ops when max age unset`() {
        SignedDefsVerify.assertEnvelopeFreshness(1L, maxSignatureAgeSeconds = null)
        SignedDefsVerify.assertEnvelopeFreshness(1L, maxSignatureAgeSeconds = 0L)
    }

    @Test
    fun `assertEnvelopeFreshness rejects stale and future timestamps`() {
        assertThrows(IllegalArgumentException::class.java) {
            SignedDefsVerify.assertEnvelopeFreshness(
                timestamp = 100L,
                maxSignatureAgeSeconds = 300L,
                nowSeconds = 1000L
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            SignedDefsVerify.assertEnvelopeFreshness(
                timestamp = 2000L,
                maxSignatureAgeSeconds = 300L,
                nowSeconds = 1000L
            )
        }
        SignedDefsVerify.assertEnvelopeFreshness(
            timestamp = 900L,
            maxSignatureAgeSeconds = 300L,
            nowSeconds = 1000L
        )
    }

    private fun createKey(): TestKey {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val pair = generator.generateKeyPair()
        val publicKey = pair.public as ECPublicKey
        val x = fixedLength(publicKey.w.affineX)
        val y = fixedLength(publicKey.w.affineY)
        val kidBytes = x + y
        val kid = MessageDigest.getInstance("SHA-1").digest(kidBytes)
            .joinToString(separator = "") { "%02X".format(it) } + "ES256"

        return TestKey(pair, base64Url(x), base64Url(y), kid)
    }

    private fun jwks(key: TestKey): String {
        return """{"keys":[{"kty":"EC","alg":"ES256","crv":"P-256","x":"${key.x}","y":"${key.y}","kid":"${key.kid}"}]}"""
    }

    private fun signP1363(key: TestKey, digest: ByteArray): ByteArray {
        val signer = Signature.getInstance("NONEwithECDSA")
        signer.initSign(key.pair.private)
        signer.update(digest)
        return derToP1363(signer.sign())
    }

    private fun derToP1363(der: ByteArray): ByteArray {
        var offset = 2
        val rLength = der[offset + 1].toInt()
        val r = der.copyOfRange(offset + 2, offset + 2 + rLength)
        offset += 2 + rLength
        val sLength = der[offset + 1].toInt()
        val s = der.copyOfRange(offset + 2, offset + 2 + sLength)
        return fixedLength(BigInteger(r)) + fixedLength(BigInteger(s))
    }

    private fun fixedLength(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        return when {
            bytes.size == 32 -> bytes
            bytes.size > 32 -> bytes.copyOfRange(bytes.size - 32, bytes.size)
            else -> ByteArray(32 - bytes.size) + bytes
        }
    }

    private fun base64(value: ByteArray): String = Base64.getEncoder().encodeToString(value)

    private fun base64Url(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)

    private data class TestKey(
        val pair: KeyPair,
        val x: String,
        val y: String,
        val kid: String
    )
}
