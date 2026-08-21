package io.toggly.core

import io.toggly.core.models.TogglyConfig
import io.toggly.core.models.TogglyFeatureFlagsCache
import io.toggly.core.models.TogglyStorageKeys
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

@OptIn(ExperimentalCoroutinesApi::class)
class FeatureFlagsCacheTest {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
    }

    @Test
    fun `decodes legacy cache json without envelope metadata`() {
        val legacy = """{"identity":"user-1","flags":"{\"A\":true}"}"""
        val cache = json.decodeFromString(TogglyFeatureFlagsCache.serializer(), legacy)

        assertEquals("user-1", cache.identity)
        assertEquals("""{"A":true}""", cache.flags)
        assertNull(cache.timestamp)
        assertNull(cache.signature)
        assertNull(cache.keyId)
    }

    @Test
    fun `round-trips envelope metadata`() {
        val cache = TogglyFeatureFlagsCache(
            identity = "user-1",
            flags = """{"A":true}""",
            timestamp = 1_700_000_000L,
            signature = "sig",
            keyId = "kid"
        )
        val encoded = json.encodeToString(TogglyFeatureFlagsCache.serializer(), cache)
        val decoded = json.decodeFromString(TogglyFeatureFlagsCache.serializer(), encoded)

        assertEquals(cache, decoded)
    }

    @Test
    fun `cold start re-verifies signed cache with persisted jwks`() = runTest {
        val key = createKey()
        val identity = "user-1"
        val defs = """{"PresalePhotos":true,"PuppySales":false}"""
        val timestamp = System.currentTimeMillis() / 1000L
        val signature = base64(signP1363(key, SignedDefsVerify.doubleSha256("$defs|$timestamp")))
        val storage = MemoryStorage()

        val cache = TogglyFeatureFlagsCache(
            identity = identity,
            flags = defs,
            timestamp = timestamp,
            signature = signature,
            keyId = key.kid
        )
        storage.set(
            TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity),
            json.encodeToString(TogglyFeatureFlagsCache.serializer(), cache)
        )
        storage.set(TogglyStorageKeys.JWKS, jwks(key))

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = true,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        val response = service.init()
        assertTrue(service.isFeatureOn("PresalePhotos"))
        assertFalse(service.isFeatureOn("PuppySales"))
        assertEquals(true, response.flags["PresalePhotos"])
        assertEquals(false, response.flags["PuppySales"])
    }

    @Test
    fun `cold start clears cache on invalid signature when jwks available`() = runTest {
        val key = createKey()
        val other = createKey()
        val identity = "user-1"
        val defs = """{"PresalePhotos":true}"""
        val timestamp = System.currentTimeMillis() / 1000L
        val storage = MemoryStorage()
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity)
        val wrongSignature = base64(signP1363(other, SignedDefsVerify.doubleSha256("$defs|$timestamp")))

        storage.set(
            cacheKey,
            json.encodeToString(
                TogglyFeatureFlagsCache.serializer(),
                TogglyFeatureFlagsCache(
                    identity = identity,
                    flags = defs,
                    timestamp = timestamp,
                    signature = wrongSignature,
                    keyId = key.kid
                )
            )
        )
        storage.set(TogglyStorageKeys.JWKS, jwks(key))

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = true,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertFalse(service.isFeatureOn("PresalePhotos"))
        assertNull(storage.get(cacheKey))
    }

    @Test
    fun `cold start soft-fails when jwks unavailable`() = runTest {
        val key = createKey()
        val identity = "user-1"
        val defs = """{"PresalePhotos":true}"""
        val timestamp = System.currentTimeMillis() / 1000L
        val signature = base64(signP1363(key, SignedDefsVerify.doubleSha256("$defs|$timestamp")))
        val storage = MemoryStorage()

        storage.set(
            TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity),
            json.encodeToString(
                TogglyFeatureFlagsCache.serializer(),
                TogglyFeatureFlagsCache(
                    identity = identity,
                    flags = defs,
                    timestamp = timestamp,
                    signature = signature,
                    keyId = key.kid
                )
            )
        )

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = true,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertTrue(service.isFeatureOn("PresalePhotos"))
    }

    @Test
    fun `cold start clears cache on unknown kid when jwks available`() = runTest {
        val key = createKey()
        val identity = "user-1"
        val defs = """{"PresalePhotos":true}"""
        val timestamp = System.currentTimeMillis() / 1000L
        val storage = MemoryStorage()
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity)
        val signature = base64(signP1363(key, SignedDefsVerify.doubleSha256("$defs|$timestamp")))

        storage.set(
            cacheKey,
            json.encodeToString(
                TogglyFeatureFlagsCache.serializer(),
                TogglyFeatureFlagsCache(
                    identity = identity,
                    flags = defs,
                    timestamp = timestamp,
                    signature = signature,
                    keyId = "unknown-kid-not-in-jwks"
                )
            )
        )
        storage.set(TogglyStorageKeys.JWKS, jwks(key))

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = true,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertFalse(service.isFeatureOn("PresalePhotos"))
        assertNull(storage.get(cacheKey))
    }

    @Test
    fun `cold start uses defaults when cached flags are not json`() = runTest {
        val identity = "user-1"
        val storage = MemoryStorage()
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity)
        storage.set(
            cacheKey,
            json.encodeToString(
                TogglyFeatureFlagsCache.serializer(),
                TogglyFeatureFlagsCache(identity = identity, flags = "not-json")
            )
        )

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = false,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertFalse(service.isFeatureOn("PresalePhotos"))
        assertNull(storage.get(cacheKey))
    }

    @Test
    fun `cold start clears stale signed cache`() = runTest {
        val key = createKey()
        val identity = "user-1"
        val defs = """{"PresalePhotos":true}"""
        val timestamp = 1_000L
        val storage = MemoryStorage()
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity)
        storage.set(
            cacheKey,
            json.encodeToString(
                TogglyFeatureFlagsCache.serializer(),
                TogglyFeatureFlagsCache(
                    identity = identity,
                    flags = defs,
                    timestamp = timestamp,
                    signature = base64(signP1363(key, SignedDefsVerify.doubleSha256("$defs|$timestamp"))),
                    keyId = key.kid
                )
            )
        )
        storage.set(TogglyStorageKeys.JWKS, jwks(key))

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = true,
                maxSignatureAgeSeconds = 60L,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertFalse(service.isFeatureOn("PresalePhotos"))
        assertNull(storage.get(cacheKey))
    }

    @Test
    fun `unsigned cache is trusted when signature verification is off`() = runTest {
        val identity = "user-1"
        val storage = MemoryStorage()
        storage.set(
            TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity),
            """{"identity":"$identity","flags":"{\"PresalePhotos\":true}"}"""
        )

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = false,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertTrue(service.isFeatureOn("PresalePhotos"))
    }

    @Test
    fun `cold start clears unsigned legacy cache when verifySignatures enabled`() = runTest {
        val identity = "user-1"
        val storage = MemoryStorage()
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity)
        storage.set(
            cacheKey,
            """{"identity":"$identity","flags":"{\"PresalePhotos\":true}"}"""
        )

        val service = TogglyService(
            TogglyConfig(
                appKey = "app",
                baseUri = "https://127.0.0.1:9",
                identity = identity,
                verifySignatures = true,
                refreshInterval = 0,
                enableLiveUpdates = false,
                connectTimeout = 1_000L,
                requestTimeout = 1_000L,
                storage = storage,
                featureDefaults = mapOf("PresalePhotos" to false)
            )
        )

        service.init()
        assertFalse(service.isFeatureOn("PresalePhotos"))
        assertNull(storage.get(cacheKey))
    }

    private fun hashIdentity(identity: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(identity.toByteArray())
        return hash.joinToString("") { "%02x".format(it) }.take(16)
    }

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

    private fun base64Url(value: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(value)

    private data class TestKey(
        val pair: KeyPair,
        val x: String,
        val y: String,
        val kid: String
    )
}
