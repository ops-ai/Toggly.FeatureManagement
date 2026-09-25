package io.toggly.core

import io.toggly.core.models.NetworkState
import io.toggly.core.models.TogglyConfig
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.Base64

/**
 * Covers `enableVariants` end to end: raw variant-def parsing, the
 * `evaluated-signed` -> `evaluated-variants-signed` endpoint switch,
 * `getVariant` / `getVariantValue`, signed-envelope verification, and
 * cold-start cache reload — matching the Flutter/JS SDK contract.
 */
class VariantsTest {

    // ---- Pure parsing (Variants.kt) ----

    @Test
    fun `parseVariantDefinitionValue reads enabled variant and configuration`() {
        val element = Json.parseToJsonElement(
            """{"enabled":true,"variant":"B","configurationValue":{"color":"blue","limit":3}}"""
        )
        val parsed = parseVariantDefinitionValue(element)
        assertTrue(parsed.enabled)
        assertEquals("B", parsed.variant)
        @Suppress("UNCHECKED_CAST")
        val config = parsed.configurationValue as Map<String, Any?>
        assertEquals("blue", config["color"])
        assertEquals(3L, config["limit"])
    }

    @Test
    fun `parseVariantDefinitionValue defaults enabled to false when missing`() {
        val parsed = parseVariantDefinitionValue(Json.parseToJsonElement("""{}"""))
        assertFalse(parsed.enabled)
        assertNull(parsed.variant)
        assertNull(parsed.configurationValue)
    }

    @Test
    fun `parseVariantDefinitionValue ignores gate-shaped entries without a variant`() {
        // The variants endpoint echoes { enabled:false, requirement, rules } for
        // unresolved entity gates; variant evaluation ignores those fields.
        val parsed = parseVariantDefinitionValue(
            Json.parseToJsonElement("""{"enabled":false,"requirement":"all","rules":[]}""")
        )
        assertFalse(parsed.enabled)
        assertNull(parsed.variant)
    }

    @Test
    fun `parseVariantDefinitions maps every feature key`() {
        val defs = parseVariantDefinitions(
            """{"a":{"enabled":true},"b":{"enabled":true,"variant":"X"}}"""
        )
        assertEquals(setOf("a", "b"), defs.keys)
        assertTrue(defs["a"]!!.enabled)
        assertEquals("X", defs["b"]!!.variant)
    }

    @Test
    fun `jsonElementToKotlinValue keeps quoted booleans and numbers as strings`() {
        val obj = Json.parseToJsonElement(
            """{"flag":"true","count":"42","real":true,"n":42,"f":1.5,"nested":{"a":[1,"two",null]}}"""
        ) as kotlinx.serialization.json.JsonObject

        assertEquals("true", jsonElementToKotlinValue(obj["flag"]!!))
        assertEquals("42", jsonElementToKotlinValue(obj["count"]!!))
        assertEquals(true, jsonElementToKotlinValue(obj["real"]!!))
        assertEquals(42L, jsonElementToKotlinValue(obj["n"]!!))
        assertEquals(1.5, jsonElementToKotlinValue(obj["f"]!!))
        assertNull(jsonElementToKotlinValue(Json.parseToJsonElement("null")))

        @Suppress("UNCHECKED_CAST")
        val nested = jsonElementToKotlinValue(obj["nested"]!!) as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val list = nested["a"] as List<Any?>
        assertEquals(listOf(1L, "two", null), list)
    }

    // ---- Service-level: endpoint switch, evaluation, telemetry, cache ----

    private fun config(server: MockWebServer, enableVariants: Boolean = true) = TogglyConfig(
        appKey = "test-app",
        baseUri = server.url("/").toString(),
        enableVariants = enableVariants,
        enableTelemetry = false,
        enableLiveUpdates = false,
        refreshInterval = 0
    )

    @Test
    fun `getVariant is always null when enableVariants is false`() = runBlocking {
        val service = TogglyService(
            TogglyConfig(enableTelemetry = false, featureDefaults = mapOf("a" to true))
        )
        try {
            assertNull(service.getVariant("a"))
            assertNull(service.getVariantValue("a"))
            assertNull(service.currentVariants)
        } finally {
            service.dispose()
        }
    }

    @Test
    fun `endpoint stays evaluated-signed when enableVariants is false`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"a":true}"""))
            val service = TogglyService(config(server, enableVariants = false))
            try {
                service.init()
                val request = server.takeRequest()
                assertEquals("/evaluated-signed/test-app/Production", request.requestUrl!!.encodedPath)
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `endpoint switches to evaluated-variants-signed when enableVariants is true`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"a":{"enabled":true}}"""))
            val service = TogglyService(config(server))
            try {
                service.init()
                val request = server.takeRequest()
                assertEquals(
                    "/evaluated-variants-signed/test-app/Production",
                    request.requestUrl!!.encodedPath
                )
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `getVariant returns assigned variant with configuration value`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"feature-a":{"enabled":true,"variant":"B","configurationValue":{"color":"blue"}}}"""
                )
            )
            val service = TogglyService(config(server))
            try {
                service.init()
                assertTrue(service.isFeatureOn("feature-a"))
                val variant = service.getVariant("feature-a")
                assertNotNull(variant)
                assertEquals("B", variant!!.name)
                @Suppress("UNCHECKED_CAST")
                val configValue = variant.configurationValue as Map<String, Any?>
                assertEquals("blue", configValue["color"])
                assertEquals(mapOf("color" to "blue"), service.getVariantValue("feature-a"))
                assertEquals(mapOf("feature-a" to variant), service.currentVariants)
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `getVariant returns null when feature has no variant assignment`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"feature-b":{"enabled":true}}"""))
            val service = TogglyService(config(server))
            try {
                service.init()
                assertTrue(service.isFeatureOn("feature-b"))
                assertNull(service.getVariant("feature-b"))
                assertNull(service.getVariantValue("feature-b"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `getVariant returns null when feature is disabled even with variant metadata`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"feature-c":{"enabled":false,"variant":"X","configurationValue":"ignored"}}"""
                )
            )
            val service = TogglyService(config(server))
            try {
                service.init()
                assertFalse(service.isFeatureOn("feature-c"))
                assertNull(service.getVariant("feature-c"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `getVariant returns null for an unknown feature key`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"feature-a":{"enabled":true,"variant":"B"}}"""))
            val service = TogglyService(config(server))
            try {
                service.init()
                assertNull(service.getVariant("does-not-exist"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `variant assignment persists across cold restart via cache`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setHeader("ETag", "rev-1").setBody(
                    """{"feature-a":{"enabled":true,"variant":"B","configurationValue":42}}"""
                )
            )
            val storage = MemoryStorage()
            val cfg = config(server).copy(identity = "user-1", storage = storage)
            val warm = TogglyService(cfg)
            try {
                warm.init()
            } finally {
                warm.dispose()
            }

            val cold = TogglyService(cfg)
            try {
                cold.setNetworkState(NetworkState(false))
                cold.init()
                val variant = cold.getVariant("feature-a")
                assertNotNull(variant)
                assertEquals("B", variant!!.name)
                assertEquals(42L, variant.configurationValue)
            } finally {
                cold.dispose()
            }
        }
    }

    @Test
    fun `clearCache drops in-memory variant assignments`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"feature-a":{"enabled":true,"variant":"B"}}"""))
            val service = TogglyService(config(server))
            try {
                service.init()
                assertNotNull(service.getVariant("feature-a"))
                service.clearCache()
                assertNull(service.currentVariants)
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `setIdentity refetches and replaces variant assignments`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"feature-a":{"enabled":true}}"""))
            server.enqueue(MockResponse().setBody("""{"feature-a":{"enabled":true,"variant":"B"}}"""))
            val service = TogglyService(config(server).copy(identity = "alice"))
            try {
                service.init()
                assertNull(service.getVariant("feature-a"))
                service.setIdentity("bob")
                assertNotNull(service.getVariant("feature-a"))
            } finally {
                service.dispose()
            }
        }
    }

    // ---- Signed envelope verification over raw variant defs ----

    @Test
    fun `getVariant verifies a signed envelope over the raw variant defs`() = runBlocking {
        val key = createKey()
        val defs = """{"feature-a":{"enabled":true,"variant":"B","configurationValue":{"n":1}}}"""
        val timestamp = 1_800_000_000L
        val signature = base64(signP1363(key, doubleSha256("$defs|$timestamp")))
        val body = """{"defs":$defs,"signature":"$signature","timestamp":$timestamp,"kid":"${key.kid}"}"""

        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path?.contains("jwks") == true) {
                        return MockResponse().setBody(jwks(key))
                    }
                    return MockResponse().setBody(body)
                }
            }
            val service = TogglyService(config(server).copy(verifySignatures = true))
            try {
                service.init()
                val variant = service.getVariant("feature-a")
                assertNotNull(variant)
                assertEquals("B", variant!!.name)
                @Suppress("UNCHECKED_CAST")
                val configValue = variant.configurationValue as Map<String, Any?>
                assertEquals(1L, configValue["n"])
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `getVariant fails closed when the signed variants envelope is tampered`() = runBlocking {
        val key = createKey()
        val defs = """{"feature-a":{"enabled":true,"variant":"B"}}"""
        val timestamp = 1_800_000_000L
        val signature = base64(signP1363(key, doubleSha256("$defs|$timestamp")))
        // Serve a different defs payload than what was signed.
        val tamperedDefs = """{"feature-a":{"enabled":true,"variant":"EVIL"}}"""
        val body = """{"defs":$tamperedDefs,"signature":"$signature","timestamp":$timestamp,"kid":"${key.kid}"}"""

        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.path?.contains("jwks") == true) {
                        return MockResponse().setBody(jwks(key))
                    }
                    return MockResponse().setBody(body)
                }
            }
            val service = TogglyService(config(server).copy(verifySignatures = true, featureDefaults = mapOf("feature-a" to false)))
            try {
                service.init()
                assertNull(service.getVariant("feature-a"))
                assertFalse(service.isFeatureOn("feature-a"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `typed getVariantValue soft-decodes maps and soft-nulls mismatches`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"feature-a":{"enabled":true,"variant":"B","configurationValue":{"color":"blue"}}}"""
                )
            )
            val service = TogglyService(config(server))
            try {
                service.init()
                val typed = service.getVariantValue<PricingConfig>("feature-a")
                assertEquals(PricingConfig(color = "blue"), typed)
                assertEquals(
                    PricingConfig(color = "blue"),
                    service.getVariantValue("feature-a", PricingConfig::class.java)
                )
                assertNull(service.getVariantValue<String>("feature-a"))
                assertNull(service.getVariantValue("feature-a", String::class.java))
                assertNull(service.getVariantValue<PricingConfig>("missing"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `typed getVariantValue returns scalars when types match`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"banner":{"enabled":true,"variant":"A","configurationValue":"hello"}}"""
                )
            )
            val service = TogglyService(config(server))
            try {
                service.init()
                assertEquals("hello", service.getVariantValue<String>("banner"))
                assertNull(service.getVariantValue<Long>("banner"))
            } finally {
                service.dispose()
            }
        }
    }

    @kotlinx.serialization.Serializable
    private data class PricingConfig(val color: String)

    private fun createKey(): TestKey {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val pair = generator.generateKeyPair()
        val publicKey = pair.public as ECPublicKey
        val x = fixedLength(publicKey.w.affineX)
        val y = fixedLength(publicKey.w.affineY)
        val kid = MessageDigest.getInstance("SHA-1").digest(x + y)
            .joinToString(separator = "") { "%02X".format(it) } + "ES256"
        return TestKey(pair, base64Url(x), base64Url(y), kid)
    }

    private fun jwks(key: TestKey): String =
        """{"keys":[{"kty":"EC","alg":"ES256","crv":"P-256","x":"${key.x}","y":"${key.y}","kid":"${key.kid}"}]}"""

    private fun signP1363(key: TestKey, digest: ByteArray): ByteArray {
        val signer = Signature.getInstance("NONEwithECDSA")
        signer.initSign(key.pair.private)
        signer.update(digest)
        return derToP1363(signer.sign())
    }

    private fun doubleSha256(payload: String): ByteArray = SignedDefsVerify.doubleSha256(payload)

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

    private fun base64Url(value: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(value)

    private data class TestKey(val pair: KeyPair, val x: String, val y: String, val kid: String)
}
