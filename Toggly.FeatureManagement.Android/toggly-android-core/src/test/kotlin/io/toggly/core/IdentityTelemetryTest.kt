package io.toggly.core

import io.toggly.core.models.*
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class IdentityTelemetryTest {
    private fun packet(request: RecordedRequest): JSONObject {
        val bytes = request.body.readByteArray()
        return JSONObject(if (request.getHeader("Content-Encoding") == "gzip")
            GZIPInputStream(bytes.inputStream()).readBytes().decodeToString() else bytes.decodeToString())
    }
    private fun options(server: MockWebServer, identity: String? = "alice") = TogglyConfig(
        appKey = "test-app", identity = identity, baseUri = server.url("/").toString(),
        metricsBaseUrl = server.url("/").toString(), refreshInterval = 0, enableLiveUpdates = false,
        verifySignatures = false, featureDefaults = mapOf("flag" to false))

    @Test fun changingIdentitySeparatesAlreadyAcceptedEventsAndGauges() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(options(server))
            try {
                service.setNetworkState(NetworkState(false)); service.init()
                service.recordUsage("before"); service.setGauge("cart", 1.0)
                service.setIdentity("bob")
                service.recordUsage("after"); service.setGauge("cart", 2.0)
                service.flushTelemetry()
                val old = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                val next = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertEquals("alice", old.getString("u")); assertEquals("bob", next.getString("u"))
                assertFalse(old.getJSONObject("f").has("after")); assertFalse(next.getJSONObject("f").has("before"))
                assertEquals(1, old.getJSONObject("m").getInt("cart")); assertEquals(2, next.getJSONObject("m").getInt("cart"))
            } finally { service.dispose() }
        }
    }

    @Test fun generatedDeviceIdentityReachesTelemetryWithoutRelabelingPreinitEvents() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(options(server, null))
            try {
                service.recordUsage("before")
                service.setNetworkState(NetworkState(false)); service.init()
                val generated = service.currentIdentity
                assertFalse(generated.isNullOrBlank())
                service.recordUsage("after"); service.flushTelemetry()
                val old = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                val next = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertFalse(old.has("u")); assertEquals(generated, next.getString("u"))
            } finally { service.dispose() }
        }
    }

    @Test fun mintedDefinitionsSuppressUntrustedTargetingAndIdentityChangeClearsToken() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setBody("{\"flag\":true}")) }
            val service = TogglyService(options(server).copy(instanceId = " minted-token ",
                groups = listOf("admins"), claims = mapOf("plan" to "pro"), enableTelemetry = false))
            try {
                service.init()
                val minted = server.takeRequest(2, TimeUnit.SECONDS)!!.requestUrl!!
                assertEquals("minted-token", minted.queryParameter("i"))
                assertNull(minted.queryParameter("u")); assertNull(minted.queryParameter("g"))
                assertNull(minted.queryParameter("claim.plan"))
                service.setIdentity("bob")
                val fallback = server.takeRequest(2, TimeUnit.SECONDS)!!.requestUrl!!
                assertNull(fallback.queryParameter("i")); assertEquals("bob", fallback.queryParameter("u"))
                assertEquals("admins", fallback.queryParameter("g")); assertEquals("pro", fallback.queryParameter("claim.plan"))
            } finally { service.dispose() }
        }
    }
    @Test fun tokenRotationSeparatesValidatorsAndPersistedCachesAndClearRestoresDeviceIdentity() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("ETag", "revision-a").setBody("{\"onlyA\":true}"))
            server.enqueue(MockResponse().setHeader("ETag", "revision-b").setBody("{\"onlyB\":true}"))
            val storage = MemoryStorage()
            storage.set(TogglyStorageKeys.DEVICE_ID, "cached-device")
            val config = options(server, null).copy(instanceId = "token-a", storage = storage, useSignedDefinitions = true, enableTelemetry = false)
            val service = TogglyService(config)
            try {
                service.init(); assertEquals("token-a", server.takeRequest(2, TimeUnit.SECONDS)!!.requestUrl!!.queryParameter("i"))
                service.setInstanceId("token-b")
                val rotated = server.takeRequest(2, TimeUnit.SECONDS)!!
                assertNull(rotated.getHeader("If-None-Match")); assertEquals("token-b", rotated.requestUrl!!.queryParameter("i"))
                assertNull(service.currentFeatures?.get("onlyA")); assertTrue(service.isFeatureOn("onlyB"))
                service.setNetworkState(NetworkState(false))
                service.setInstanceId("token-a"); assertTrue(service.isFeatureOn("onlyA")); assertFalse(service.isFeatureOn("onlyB"))
                service.setInstanceId("token-b"); assertTrue(service.isFeatureOn("onlyB")); assertFalse(service.isFeatureOn("onlyA"))
                service.setInstanceId("  "); assertNull(service.currentInstanceId)
                assertEquals("cached-device", service.currentIdentity)
                assertFalse(service.isFeatureOn("onlyA")); assertFalse(service.isFeatureOn("onlyB"))
                service.setIdentity("bob", "token-c"); assertEquals("token-c", service.currentInstanceId)
                service.init(); assertEquals("bob", service.currentIdentity); assertEquals("token-c", service.currentInstanceId)
                service.setIdentity(null); assertEquals("cached-device", service.currentIdentity); assertNull(service.currentInstanceId)
            } finally { service.dispose() }
            val cold = TogglyService(config.copy(instanceId = "token-b"))
            try {
                cold.setNetworkState(NetworkState(false)); cold.init()
                assertTrue(cold.isFeatureOn("onlyB")); assertFalse(cold.isFeatureOn("onlyA"))
            } finally { cold.dispose() }
        }
    }

    @Test fun mintedContextCannotRestoreLegacyIdentityOnlyCache() = runBlocking {
        MockWebServer().use { server ->
            val storage = MemoryStorage()
            val hash = java.security.MessageDigest.getInstance("SHA-256").digest("alice".toByteArray())
                .joinToString("") { "%02x".format(it) }.take(16)
            storage.set(TogglyStorageKeys.FEATURE_FLAGS_CACHE + hash,
                """{"identity":"alice","flags":"{\"legacy\":true}"}""")
            val minted = TogglyService(options(server).copy(instanceId = "token", storage = storage, enableTelemetry = false))
            val fallback = TogglyService(options(server).copy(storage = storage, enableTelemetry = false))
            try {
                minted.setNetworkState(NetworkState(false)); minted.init(); assertFalse(minted.isFeatureOn("legacy"))
                fallback.setNetworkState(NetworkState(false)); fallback.init(); assertTrue(fallback.isFeatureOn("legacy"))
            } finally { minted.dispose(); fallback.dispose() }
        }
    }

    @Test fun delayedAdapterSnapshotKeepsItsOriginalAttribution() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(options(server))
            try {
                service.setNetworkState(NetworkState(false)); service.init()
                val oldSnapshot = service.featureFlags.value
                service.setIdentity("bob")
                service.recordUsage("current")
                service.recordCachedCheck("flag", false, oldSnapshot)
                service.flushTelemetry()
                val current = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                val old = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertEquals("bob", current.getString("u")); assertEquals("alice", old.getString("u"))
                assertEquals("[1]", old.getJSONObject("f").getJSONObject("flag").getJSONArray("disabled").toString())
                assertFalse(current.getJSONObject("f").has("flag"))
            } finally { service.dispose() }
        }
    }

    @Test fun evaluationAdmissionIsAtomicWithIdentityReplacement() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(options(server))
            val entered = CompletableDeferred<Unit>()
            val release = java.util.concurrent.CountDownLatch(1)
            service.registerContext("identity-race", EntityContextMapper {
                entered.complete(Unit)
                check(release.await(5, TimeUnit.SECONDS))
                TogglyEntityContext("identity-race", "entity", emptyMap())
            })
            try {
                service.setNetworkState(NetworkState(false)); service.init()
                val evaluation = async(Dispatchers.Default) { service.isFeatureEnabled("flag", Any(), "identity-race") }
                withTimeout(5_000) { entered.await() }
                val transitionStarted = CompletableDeferred<Unit>()
                val transition = async(Dispatchers.Default) { transitionStarted.complete(Unit); service.setIdentity("bob") }
                withTimeout(5_000) { transitionStarted.await() }
                withTimeout(5_000) { transition.await() }
                assertEquals("bob", service.currentIdentity)
                release.countDown()
                assertFalse(withTimeout(5_000) { evaluation.await() })
                service.recordUsage("after"); service.flushTelemetry()
                val old = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                val next = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertEquals("alice", old.getString("u")); assertEquals("bob", next.getString("u"))
                assertEquals("[1]", old.getJSONObject("f").getJSONObject("flag").getJSONArray("disabled").toString())
                assertFalse(next.getJSONObject("f").has("flag"))
            } finally { release.countDown(); service.dispose(); clearRegisteredContexts() }
        }
    }

    @Test fun lateInitializationCannotRestoreGeneratedIdentityAfterExplicitTransition() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val storage = object : TogglyStorage by MemoryStorage() {
                override suspend fun get(key: String): String? {
                    if (key == TogglyStorageKeys.DEVICE_ID) { entered.complete(Unit); release.await(); return "device" }
                    return null
                }
            }
            val service = TogglyService(options(server, null).copy(storage = storage))
            try {
                service.setNetworkState(NetworkState(false))
                val initialization = async { service.init() }
                withTimeout(5_000) { entered.await() }
                service.recordUsage("before-init")
                val replacement = async { service.setIdentity("bob", "bob-token") }
                yield(); assertFalse(replacement.isCompleted)
                release.complete(Unit)
                withTimeout(5_000) { initialization.await(); replacement.await() }
                service.init()
                assertEquals("bob", service.currentIdentity); assertEquals("bob-token", service.currentInstanceId)
                service.recordUsage("after-init"); service.flushTelemetry()
                val old = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                val next = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertFalse(old.has("u")); assertFalse(old.has("i"))
                assertEquals("bob-token", next.getString("i")); assertFalse(next.has("u"))
            } finally { release.complete(Unit); service.dispose() }
        }
    }

    @Test fun delayedOldTokenResponseCannotPublishAfterReplacementOrReuseValidator() = runBlocking {
        MockWebServer().use { server ->
            val entered = CompletableDeferred<Unit>()
            val release = java.util.concurrent.CountDownLatch(1)
            server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.requestUrl!!.queryParameter("i") == "token-a") {
                        entered.complete(Unit); check(release.await(5, TimeUnit.SECONDS))
                        return MockResponse().setHeader("ETag", "revision-a").setBody("{\"onlyA\":true}")
                    }
                    return MockResponse().setBody("{\"onlyB\":true}")
                }
            }
            val service = TogglyService(options(server).copy(instanceId = "token-a", useSignedDefinitions = true, enableTelemetry = false))
            try {
                val old = async { service.init() }
                withTimeout(5_000) { entered.await() }
                val transition = async { service.setInstanceId("token-b") }
                yield(); assertFalse(transition.isCompleted)
                release.countDown()
                withTimeout(5_000) { old.await(); transition.await() }
                server.takeRequest(2, TimeUnit.SECONDS)!!
                val next = server.takeRequest(2, TimeUnit.SECONDS)!!
                assertEquals("token-b", next.requestUrl!!.queryParameter("i")); assertNull(next.getHeader("If-None-Match"))
                assertTrue(service.isFeatureOn("onlyB")); assertFalse(service.isFeatureOn("onlyA"))
            } finally { release.countDown(); service.dispose() }
        }
    }

    @Test fun delayedCacheReadCannotRelabelPreviousTokenSnapshot() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"onlyA\":true}"))
            val backing = MemoryStorage()
            val options = options(server).copy(instanceId = "token-a", storage = backing, enableTelemetry = false)
            val seed = TogglyService(options)
            try { seed.init() } finally { seed.dispose() }
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            var pause = true
            val storage = object : TogglyStorage by backing {
                override suspend fun get(key: String): String? {
                    val captured = backing.get(key)
                    if (pause && key.startsWith(TogglyStorageKeys.FEATURE_FLAGS_CACHE)) {
                        pause = false; entered.complete(Unit); release.await()
                    }
                    return captured
                }
            }
            val service = TogglyService(options.copy(storage = storage))
            try {
                service.setNetworkState(NetworkState(false))
                val evaluation = async { service.isFeatureOn("onlyA") }
                withTimeout(5_000) { entered.await() }
                service.setInstanceId("token-b")
                release.complete(Unit)
                assertFalse(withTimeout(5_000) { evaluation.await() })
                assertFalse(service.isFeatureOn("onlyA")); assertEquals("token-b", service.currentInstanceId)
            } finally { release.complete(Unit); service.dispose() }
        }
    }

    @Test fun mintedTokenRemovesTargetingAlreadyPresentInBaseUrl() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{}"))
            val service = TogglyService(options(server).copy(enableTelemetry = false, instanceId = "real-token",
                baseUri = server.url("/?u=forged&g=admins&claim.plan=pro&i=stale&region=west").toString()))
            try {
                service.init()
                val url = server.takeRequest(2, TimeUnit.SECONDS)!!.requestUrl!!
                assertEquals(listOf("real-token"), url.queryParameterValues("i"))
                assertNull(url.queryParameter("u")); assertNull(url.queryParameter("g")); assertNull(url.queryParameter("claim.plan"))
                assertEquals("west", url.queryParameter("region"))
            } finally { service.dispose() }
        }
    }

    @Test fun tokenRoundTripCannotPublishAnOldGenerationCacheRead() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"onlyA\":true}"))
            val backing = MemoryStorage()
            val writes = mutableMapOf<String, String>()
            val seedStorage = object : TogglyStorage by backing {
                override suspend fun set(key: String, value: String) { writes[key] = value; backing.set(key, value) }
            }
            val config = options(server).copy(instanceId = "token-a", storage = seedStorage, enableTelemetry = false)
            val seed = TogglyService(config)
            try { seed.init() } finally { seed.dispose() }
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            var pause = true
            val storage = object : TogglyStorage by backing {
                override suspend fun get(key: String): String? {
                    val captured = backing.get(key)
                    if (pause && key.startsWith(TogglyStorageKeys.FEATURE_FLAGS_CACHE)) {
                        pause = false; entered.complete(Unit); release.await()
                    }
                    return captured
                }
            }
            assertTrue("Definition caches must not store the raw minted capability", writes.values.none { it.contains("token-a") })
            val service = TogglyService(config.copy(storage = storage))
            try {
                service.setNetworkState(NetworkState(false))
                val evaluation = async { service.isFeatureOn("onlyA") }
                withTimeout(5_000) { entered.await() }
                for ((key, value) in writes) backing.set(key, value.replace("true", "false"))
                service.setInstanceId("token-b"); service.setInstanceId("token-a")
                assertFalse(service.isFeatureOn("onlyA"))
                release.complete(Unit)
                assertFalse(withTimeout(5_000) { evaluation.await() })
                assertFalse(service.isFeatureOn("onlyA"))
            } finally { release.complete(Unit); service.dispose() }
        }
    }

    @Test fun globalFacadeForwardsAtomicIdentityAndTokenReplacement() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            Toggly.configure(options(server))
            try {
                Toggly.shared.setNetworkState(NetworkState(false)); Toggly.init()
                Toggly.setIdentity("bob", "token")
                Toggly.recordUsage("minted")
                Toggly.setInstanceId(null)
                Toggly.recordView("fallback")
                Toggly.flushTelemetry()
                assertEquals("token", packet(server.takeRequest(2, TimeUnit.SECONDS)!!).getString("i"))
                assertEquals("bob", packet(server.takeRequest(2, TimeUnit.SECONDS)!!).getString("u"))
            } finally { Toggly.reset() }
        }
    }

    @Test fun explicitSnapshotOverrideFromAnotherClientCannotTransferItsToken() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202))
            val old = TogglyService(options(server).copy(appKey = "old-app", instanceId = "old-token"))
            val next = TogglyService(options(server, "bob").copy(appKey = "new-app"))
            try {
                old.setNetworkState(NetworkState(false)); old.init()
                next.setNetworkState(NetworkState(false)); next.init()
                next.recordCachedCheck("flag", false, old.featureFlags.value)
                next.flushTelemetry()
                val body = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertEquals("new-app", body.getString("k")); assertEquals("bob", body.getString("u"))
                assertFalse(body.has("i"))
            } finally { old.dispose(); next.dispose() }
        }
    }

    @Test fun reentrantEntityMapperCannotRelabelTheDefinitionBeingEvaluated() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(options(server))
            service.registerContext("reentrant", EntityContextMapper {
                runBlocking { service.setIdentity("bob") }
                TogglyEntityContext("reentrant", "entity", emptyMap())
            })
            try {
                service.setNetworkState(NetworkState(false)); service.init()
                assertFalse(service.isFeatureEnabled("flag", Any(), "reentrant"))
                assertEquals("bob", service.currentIdentity)
                service.recordUsage("after"); service.flushTelemetry()
                val old = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                val next = packet(server.takeRequest(2, TimeUnit.SECONDS)!!)
                assertEquals("alice", old.getString("u")); assertEquals("bob", next.getString("u"))
            } finally { service.dispose(); clearRegisteredContexts() }
        }
    }

    @Test fun obsoleteInvalidCacheReadCannotDeleteNewGenerationCache() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"onlyA\":true}"))
            val backing = MemoryStorage()
            val writes = mutableMapOf<String, String>()
            val seedStorage = object : TogglyStorage by backing {
                override suspend fun set(key: String, value: String) { writes[key] = value; backing.set(key, value) }
            }
            val config = options(server).copy(instanceId = "token-a", storage = seedStorage, enableTelemetry = false)
            val seed = TogglyService(config)
            try { seed.init() } finally { seed.dispose() }
            val entered = CompletableDeferred<Unit>(); val release = CompletableDeferred<Unit>()
            var pause = true
            val storage = object : TogglyStorage by backing {
                override suspend fun get(key: String): String? {
                    val captured = backing.get(key)
                    if (pause && key.startsWith(TogglyStorageKeys.FEATURE_FLAGS_CACHE)) {
                        pause = false; entered.complete(Unit); release.await()
                        return JSONObject(captured!!).put("flags", "invalid-json").toString()
                    }
                    return captured
                }
            }
            val service = TogglyService(config.copy(storage = storage))
            try {
                service.setNetworkState(NetworkState(false))
                val evaluation = async { service.isFeatureOn("onlyA") }
                withTimeout(5_000) { entered.await() }
                service.setInstanceId("token-b"); service.setInstanceId("token-a")
                release.complete(Unit); assertTrue(withTimeout(5_000) { evaluation.await() })
                for (key in writes.keys) assertNotNull("An obsolete verifier must not delete the replacement cache", backing.get(key))
            } finally { release.complete(Unit); service.dispose() }
        }
    }

    @Test fun invalidCacheCleanupFailureStillReturnsSafeDefaults() = runBlocking {
        MockWebServer().use { server ->
            val storage = object : TogglyStorage by MemoryStorage() {
                override suspend fun get(key: String): String? = if (key.startsWith(TogglyStorageKeys.FEATURE_FLAGS_CACHE))
                    """{"identity":"alice","flags":"invalid-json"}""" else null
                override suspend fun delete(key: String) { throw java.io.IOException("storage unavailable") }
            }
            val service = TogglyService(options(server).copy(storage = storage, enableTelemetry = false))
            try {
                service.setNetworkState(NetworkState(false))
                assertEquals(false, service.init().flags["flag"])
                assertFalse(service.isFeatureOn("flag"))
            } finally { service.dispose() }
        }
    }

    @Test fun attributedSnapshotsKeepOrdinaryMapEqualityAcrossContexts() = runBlocking {
        val service = TogglyService(TogglyConfig(identity = "alice", enableTelemetry = false,
            featureDefaults = mapOf("flag" to false), refreshInterval = 0, enableLiveUpdates = false))
        try {
            service.init()
            val first = service.featureFlags.value
            service.setIdentity("bob", "token")
            val second = service.featureFlags.value
            val plain = mapOf("flag" to false)
            assertTrue(first == plain); assertTrue(plain == first)
            assertTrue(first == second); assertTrue(second == first)
            assertEquals(plain.hashCode(), first.hashCode())
            assertFalse(first.equals(null)); assertFalse(first.equals("flag"))
            assertFalse(first == mapOf("flag" to true))
        } finally { service.dispose() }
    }

}
