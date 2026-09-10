package io.toggly.core

import io.toggly.core.models.*
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ContextCacheOwnershipTest {
    @Test
    fun `suspended JWKS fallback cannot relabel old identity flags`() = runBlocking {
        assertSuspendedCacheCannotReplaceIdentity(pauseJwks = true)
    }

    @Test
    fun `suspended storage read cannot relabel old identity flags`() = runBlocking {
        assertSuspendedCacheCannotReplaceIdentity(pauseJwks = false)
    }

    private suspend fun assertSuspendedCacheCannotReplaceIdentity(pauseJwks: Boolean) = coroutineScope {
        val backing = MemoryStorage()
        val entered = CompletableDeferred<Unit>()
        val resume = CompletableDeferred<Unit>()
        val hash = MessageDigest.getInstance("SHA-256").digest("A".toByteArray())
            .joinToString("") { "%02x".format(it) }.take(16)
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hash
        val pausedKey = if (pauseJwks) TogglyStorageKeys.JWKS else cacheKey
        var pause = false
        val storage = object : TogglyStorage {
            override suspend fun get(key: String): String? {
                if (pause && key == pausedKey) {
                    entered.complete(Unit)
                    resume.await()
                }
                return backing.get(key)
            }
            override suspend fun set(key: String, value: String) = backing.set(key, value)
            override suspend fun delete(key: String) = backing.delete(key)
            override suspend fun clear() = backing.clear()
        }
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(503)) // Existing unavailable-JWKS fallback.
        server.start()
        val service = TogglyService(TogglyConfig(
            appKey = "test", identity = "A", storage = storage,
            baseUri = server.url("/").toString().trimEnd('/'), verifySignatures = pauseJwks,
            refreshInterval = 0, enableLiveUpdates = false
        ))
        try {
            service.setNetworkState(NetworkState(false))
            service.init()
            service.clearCache()
            backing.set(cacheKey,
                """{"identity":"A","flags":"{\"onlyA\":true}","timestamp":${System.currentTimeMillis()/1000},"signature":"persisted-signature","keyId":"key"}""")
            pause = true
            val evaluation = async { service.isFeatureOn("onlyA") }
            withTimeout(5000) { entered.await() }
            service.setIdentity("B")
            assertEquals("B", service.currentIdentity)
            resume.complete(Unit)
            assertFalse(withTimeout(5000) { evaluation.await() })
            assertFalse("A cache must not become B's current snapshot", service.currentFeatures?.get("onlyA") == true)
            assertFalse(service.isFeatureOn("onlyA"))
            assertFalse(service.refresh().flags["onlyA"] == true)
        } finally {
            resume.complete(Unit)
            service.dispose()
            server.shutdown()
        }
    }

    @Test
    fun `in flight response and validator stay owned by original identity`() = runBlocking {
        val entered = CompletableDeferred<Unit>()
        val resume = CountDownLatch(1)
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.requestUrl!!.queryParameter("u") == "A") {
                    entered.complete(Unit)
                    check(resume.await(5, TimeUnit.SECONDS))
                    return MockResponse().setHeader("ETag", "shared-revision").setBody("{\"onlyA\":true}")
                }
                return MockResponse().setHeader("ETag", "shared-revision").setBody("{\"onlyB\":true}")
            }
        }
        server.start()
        val service = TogglyService(TogglyConfig(appKey = "test", identity = "A",
            baseUri = server.url("/").toString().trimEnd('/'), useSignedDefinitions = true,
            refreshInterval = 0, enableLiveUpdates = false))
        try {
            val initialization = async { service.init() }
            withTimeout(5000) { entered.await() }
            val transition = async { service.setIdentity("B") }
            yield()
            assertFalse(transition.isCompleted)
            resume.countDown()
            assertEquals(true, withTimeout(5000) { initialization.await() }.flags["onlyA"])
            assertEquals(true, withTimeout(5000) { transition.await() }.flags["onlyB"])
            server.takeRequest()
            assertNull(server.takeRequest().getHeader("If-None-Match"))
            assertEquals("B", service.currentIdentity)
            assertNull(service.currentFeatures?.get("onlyA"))
        } finally {
            resume.countDown()
            service.dispose()
            server.shutdown()
        }
    }
}
