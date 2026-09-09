package io.toggly.core

import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.MockResponse
import io.toggly.core.models.*
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class InitialContextTest {
    @Test
    fun `first request snapshots and encodes all initial context`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{\"flag\":true}"))
        server.start()
        val storage = MemoryStorage()
        storage.set(TogglyStorageKeys.DEVICE_ID, "stale-device")
        val groups = mutableListOf(" beta ", "team a", "a&b+é", " ")
        val claims = mutableMapOf("plan&kind" to "pro+ &é", "" to "ignored", "empty" to "")
        val service = TogglyService(TogglyConfig(
            appKey = "test", identity = "user&123", groups = groups, claims = claims,
            baseUri = server.url("/").toString().trimEnd('/'), storage = storage,
            refreshInterval = 0, enableLiveUpdates = false
        ))
        groups.clear()
        claims.clear()
        try {
            assertEquals(TogglyLoadStatus.FETCHED, service.init().status)
            assertEquals(1, server.requestCount)
            val url = server.takeRequest().requestUrl!!
            assertEquals("user&123", url.queryParameter("u"))
            assertEquals(listOf("beta", "team a", "a&b+é"), url.queryParameterValues("g"))
            assertEquals("pro+ &é", url.queryParameter("claim.plan&kind"))
            assertNull(url.queryParameter("claim.empty"))
            assertNull(url.queryParameter("claim."))
        } finally { service.dispose(); server.shutdown() }
    }

    @Test
    fun `empty and omitted targeting preserve identity rules and claim normalization`() = runBlocking {
        val server = MockWebServer()
        server.start()
        val storage = MemoryStorage()
        storage.set(TogglyStorageKeys.DEVICE_ID, "device")
        try {
            for (id in listOf(null, "")) {
                server.enqueue(MockResponse().setBody("{}"))
                val service = TogglyService(TogglyConfig(appKey = "test", identity = id,
                    baseUri = server.url("/").toString().trimEnd('/'), storage = storage,
                    refreshInterval = 0, enableLiveUpdates = false))
                service.init()
                val url = server.takeRequest().requestUrl!!
                assertEquals(id ?: "device", url.queryParameter("u"))
                assertTrue(url.queryParameterValues("g").isEmpty())
                assertFalse(url.queryParameterNames.any { it.startsWith("claim.") })
                service.dispose()
            }
            server.enqueue(MockResponse().setBody("{}"))
            val service = TogglyService(TogglyConfig(appKey = "test", identity = "",
                groups = emptyList(), claims = (25 downTo 0).associate { "c%02d".format(it) to " " },
                baseUri = server.url("/").toString().trimEnd('/'), refreshInterval = 0, enableLiveUpdates = false))
            service.init()
            val url = server.takeRequest().requestUrl!!
            assertEquals((0..19).map { "claim.c%02d".format(it) }.toSet(), url.queryParameterNames - "u")
            assertEquals(" ", url.queryParameter("claim.c00"))
            service.dispose()
        } finally { server.shutdown() }
    }

    @Test
    fun `same user different context cannot reuse payload or revision`() = runBlocking {
        val server = MockWebServer()
        server.start()
        val storage = MemoryStorage()
        fun service(groups: List<String>, claims: Map<String, String> = emptyMap()) = TogglyService(TogglyConfig(
            appKey = "test", identity = "user", groups = groups, claims = claims, storage = storage,
            baseUri = server.url("/").toString().trimEnd('/'), refreshInterval = 0,
            enableLiveUpdates = false, useSignedDefinitions = true))
        try {
            val first = service(listOf("a", "b"))
            server.enqueue(MockResponse().setHeader("ETag", "same-revision").setBody("{\"flag\":true}"))
            assertEquals(true, first.init().flags["flag"])
            assertNull(server.takeRequest().getHeader("If-None-Match"))
            server.enqueue(MockResponse().setResponseCode(304))
            assertEquals(true, first.refresh().flags["flag"])
            assertEquals("same-revision", server.takeRequest().getHeader("If-None-Match"))
            first.dispose()

            for (next in listOf(service(listOf("a,b")), service(listOf("a", "b"), mapOf("plan" to "pro")), service(emptyList()))) {
                server.enqueue(MockResponse().setResponseCode(503))
                assertNull(next.init().flags["flag"])
                assertNull(server.takeRequest().getHeader("If-None-Match"))
                next.dispose()
            }
            val matching = service(listOf("a", "b"))
            server.enqueue(MockResponse().setResponseCode(503))
            assertEquals(true, matching.init().flags["flag"])
            server.takeRequest()
            matching.dispose()
        } finally { server.shutdown() }
    }

    @Test
    fun `legacy identity only cache cannot supply targeted startup`() = runBlocking {
        val storage = MemoryStorage()
        val hash = java.security.MessageDigest.getInstance("SHA-256")
            .digest("user".toByteArray()).joinToString("") { "%02x".format(it) }.take(16)
        storage.set(TogglyStorageKeys.FEATURE_FLAGS_CACHE + hash,
            "{\"identity\":\"user\",\"flags\":\"{\\\"legacy\\\":true}\"}")
        val service = TogglyService(TogglyConfig(identity = "user", groups = listOf("beta"),
            storage = storage, refreshInterval = 0, enableLiveUpdates = false))
        service.setNetworkState(NetworkState(false))
        assertNull(service.init().flags["legacy"])
        service.dispose()
    }
}
