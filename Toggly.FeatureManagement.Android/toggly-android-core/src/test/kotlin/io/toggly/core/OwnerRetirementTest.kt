package io.toggly.core

import io.toggly.core.models.*
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class OwnerRetirementTest {
    private class PausedStorage(private val device: Boolean) : TogglyStorage {
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val writes = AtomicInteger()
        override suspend fun get(key: String): String? {
            if ((key == TogglyStorageKeys.DEVICE_ID) == device) {
                entered.complete(Unit)
                // Simulate an adapter that does not cooperate with cancellation.
                withContext(NonCancellable) { release.await() }
            }
            return null
        }
        override suspend fun set(key: String, value: String) { writes.incrementAndGet() }
        override suspend fun delete(key: String) { writes.incrementAndGet() }
        override suspend fun clear() { writes.incrementAndGet() }
    }

    @Test fun suspendedIdentityCannotReviveDirectlyDisposedOrReconfiguredOwner() = runBlocking {
        for (replace in listOf(false, true)) checkStorageRetirement(device = true, replace = replace)
    }

    @Test fun suspendedCacheCannotPublishAfterDirectDisposalOrReconfiguration() = runBlocking {
        for (replace in listOf(false, true)) checkStorageRetirement(device = false, replace = replace)
    }

    private suspend fun checkStorageRetirement(device: Boolean, replace: Boolean) = coroutineScope {
        MockWebServer().use { server ->
            val storage = PausedStorage(device)
            val config = TogglyConfig(appKey = "old", identity = if (device) null else "known",
                storage = storage, enableTelemetry = false, refreshInterval = 10,
                enableLiveUpdates = true, baseUri = server.url("/").toString(),
                featureDefaults = mapOf("old" to true))
            val old = if (replace) { Toggly.configure(config); Toggly.shared } else TogglyService(config)
            old.setNetworkState(NetworkState(false))
            val pending = async { old.init() }
            withTimeout(2_000) { storage.entered.await() }
            if (replace) Toggly.configure(TogglyConfig(enableTelemetry = false)) else old.dispose()
            val flagsAtDisposal = old.featureFlags.value
            storage.release.complete(Unit)
            withTimeout(2_000) { pending.await() }
            // Repeated public lifecycle calls cannot create resources on a retired owner.
            old.init(); old.refresh(); old.setIdentity("after"); old.setAppState(AppStateType.ACTIVE)
            old.setNetworkState(NetworkState(true)); old.clearCache()
            assertFalse(old.initialized)
            assertFalse(old.getDebugInfo().syncServiceRunning)
            assertNull(old.currentFeatures)
            assertEquals(flagsAtDisposal, old.featureFlags.value)
            assertEquals(0, storage.writes.get())
            assertEquals(0, server.requestCount)
            old.dispose()
            if (replace) Toggly.reset()
        }
    }

    @Test fun pendingNetworkInitAndRefreshAreCancelledWithoutPublishingOrOpeningWebSocket() = runBlocking {
        for (refresh in listOf(false, true)) {
            MockWebServer().use { server ->
                if (refresh) server.enqueue(MockResponse().setBody("{\"flag\":true}"))
                server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
                val service = TogglyService(TogglyConfig(appKey = "old", identity = "known",
                    enableTelemetry = false, refreshInterval = 0, enableLiveUpdates = !refresh,
                    baseUri = server.url("/").toString(), requestTimeout = 30_000))
                if (refresh) { service.init(); assertNotNull(server.takeRequest(2, TimeUnit.SECONDS)) }
                val pending = async { if (refresh) service.refresh() else service.init() }
                withContext(Dispatchers.IO) { assertNotNull(server.takeRequest(2, TimeUnit.SECONDS)) }
                service.dispose()
                val snapshot = service.featureFlags.value
                val debug = service.getDebugInfo()
                withTimeout(2_000) { pending.await() }
                assertFalse(service.initialized)
                assertFalse(service.getDebugInfo().syncServiceRunning)
                assertNull(service.currentFeatures)
                assertEquals(snapshot, service.featureFlags.value)
                assertEquals(debug.lastSynced, service.getDebugInfo().lastSynced)
                assertNull(server.takeRequest(100, TimeUnit.MILLISECONDS))
            }
        }
    }

    @Test fun delayedCacheWriteCannotCompleteInitializationAfterRetirement() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"flag\":true}").setHeader("ETag", "new"))
            val entered = CompletableDeferred<Unit>()
            val release = CompletableDeferred<Unit>()
            val storage = object : TogglyStorage {
                override suspend fun get(key: String): String? = null
                override suspend fun set(key: String, value: String) {
                    entered.complete(Unit)
                    withContext(NonCancellable) { release.await() }
                }
                override suspend fun delete(key: String) {}
                override suspend fun clear() {}
            }
            val service = TogglyService(TogglyConfig(appKey = "old", identity = "known", storage = storage,
                enableTelemetry = false, enableLiveUpdates = true, refreshInterval = 60_000,
                baseUri = server.url("/").toString()))
            val pending = async { service.init() }
            withTimeout(2_000) { entered.await() }
            service.dispose()
            release.complete(Unit)
            withTimeout(2_000) { pending.await() }
            assertFalse(service.initialized)
            assertFalse(service.getDebugInfo().syncServiceRunning)
            assertNull(service.currentFeatures)
            assertNull(service.getDebugInfo().lastSynced)
            assertNull(service.getDebugInfo().eTag)
            assertNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            assertNull(server.takeRequest(100, TimeUnit.MILLISECONDS))
        }
    }

    @Test fun delayedEvaluationCacheCannotRestoreDisposedSnapshot() = runBlocking {
        val storage = PausedStorage(false)
        val service = TogglyService(TogglyConfig(storage = storage, enableTelemetry = false,
            featureDefaults = mapOf("flag" to true)))
        val pending = async { service.isFeatureOn("flag") }
        withTimeout(2_000) { storage.entered.await() }
        service.dispose()
        storage.release.complete(Unit)
        assertTrue(withTimeout(2_000) { pending.await() })
        assertNull(service.currentFeatures)
        assertTrue(service.featureFlags.value.isEmpty())
    }
}
