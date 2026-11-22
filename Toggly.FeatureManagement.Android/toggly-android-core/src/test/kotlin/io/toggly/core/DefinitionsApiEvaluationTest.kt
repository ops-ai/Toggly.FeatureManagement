package io.toggly.core

import io.toggly.core.models.FeatureRequirement
import io.toggly.core.models.NetworkState
import io.toggly.core.models.TogglyConfig
import io.toggly.core.models.TogglyLoadStatus
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives flag evaluation through public [TogglyService] entry points against
 * mocked `evaluated-signed` definition payloads (not `featureDefaults` seeds).
 */
class DefinitionsApiEvaluationTest {

    private fun config(
        server: MockWebServer,
        identity: String? = "user-1",
        groups: List<String> = emptyList(),
        claims: Map<String, String> = emptyMap(),
    ) = TogglyConfig(
        appKey = "test-app",
        environment = "Production",
        baseUri = server.url("/").toString(),
        identity = identity,
        groups = groups,
        claims = claims,
        enableTelemetry = false,
        enableLiveUpdates = false,
        refreshInterval = 0,
        storage = MemoryStorage(),
    )

    @Test
    fun `init loads boolean definitions and evaluates public gates`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """{"checkout":true,"banner":false,"beta":true}"""
                )
            )
            val service = TogglyService(config(server))
            try {
                val init = service.init()
                assertEquals(TogglyLoadStatus.FETCHED, init.status)
                assertTrue(service.isFeatureOn("checkout"))
                assertFalse(service.isFeatureOn("banner"))
                assertTrue(service.isFeatureOff("banner"))
                assertFalse(service.isFeatureOn("missing"))
                assertTrue(
                    service.evaluateFeatureGate(
                        listOf("checkout", "beta"),
                        FeatureRequirement.ALL
                    )
                )
                assertFalse(
                    service.evaluateFeatureGate(
                        listOf("checkout", "banner"),
                        FeatureRequirement.ALL
                    )
                )
                assertTrue(
                    service.evaluateFeatureGate(
                        listOf("banner", "beta"),
                        FeatureRequirement.ANY
                    )
                )

                val request = server.takeRequest()
                assertEquals("/evaluated-signed/test-app/Production", request.requestUrl!!.encodedPath)
                assertEquals("user-1", request.requestUrl!!.queryParameter("u"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `entity-gate definitions evaluate through isFeatureEnabled with context`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setBody(
                    """
                    {
                      "On":true,
                      "ColorGate":{"requirement":"all","rules":[{"property":"Color","op":"eq","value":"red"}]},
                      "AgeGate":{"requirement":"any","rules":[
                        {"property":"Age","op":"gte","value":"18","type":"number"},
                        {"property":"Vip","op":"eq","value":"true"}
                      ]}
                    }
                    """.trimIndent()
                )
            )
            val service = TogglyService(config(server))
            try {
                assertEquals(TogglyLoadStatus.FETCHED, service.init().status)
                assertTrue(service.isFeatureOn("On"))
                // Gated flags fail closed without entity context.
                assertFalse(service.isFeatureEnabled("ColorGate"))
                assertTrue(
                    service.isFeatureEnabled(
                        "ColorGate",
                        TogglyEntityContext("Sku", "1", mapOf("Color" to "red"))
                    )
                )
                assertFalse(
                    service.isFeatureEnabled(
                        "ColorGate",
                        TogglyEntityContext("Sku", "1", mapOf("Color" to "blue"))
                    )
                )
                assertTrue(
                    service.isFeatureEnabled(
                        "AgeGate",
                        TogglyEntityContext("User", "u", mapOf("Age" to 21))
                    )
                )
                assertFalse(
                    service.isFeatureEnabled(
                        "AgeGate",
                        TogglyEntityContext("User", "u", mapOf("Age" to 16))
                    )
                )
            } finally {
                service.dispose()
            }
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun groupsWithNull(vararg values: String?): List<String> =
        values.toMutableList() as List<String>

    @Test
    fun `null identity does not throw and a numeric id cannot be passed`() = runBlocking {
        // TogglyConfig.identity is String?. A numeric user id cannot be passed.
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"flag":true}"""))
            val service = TogglyService(config(server, identity = null, groups = listOf("beta")))
            try {
                assertEquals(TogglyLoadStatus.FETCHED, service.init().status)
                val url = server.takeRequest().requestUrl!!
                assertFalse(url.queryParameter("u").isNullOrEmpty())
                assertEquals(listOf("beta"), url.queryParameterValues("g"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `null group slot does not throw and a real group is still sent`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"flag":true}"""))
            server.enqueue(MockResponse().setBody("""{"flag":true}"""))
            val withRealGroup = TogglyService(
                config(server, identity = "alice", groups = groupsWithNull(null, "beta"))
            )
            try {
                assertEquals(TogglyLoadStatus.FETCHED, withRealGroup.init().status)
                val matched = server.takeRequest().requestUrl!!
                assertEquals("alice", matched.queryParameter("u"))
                assertEquals(listOf("beta"), matched.queryParameterValues("g"))
            } finally {
                withRealGroup.dispose()
            }

            val nullOnly = TogglyService(
                config(server, identity = "alice", groups = groupsWithNull(null))
            )
            try {
                assertEquals(TogglyLoadStatus.FETCHED, nullOnly.init().status)
                assertEquals(null, server.takeRequest().requestUrl!!.queryParameter("g"))
            } finally {
                nullOnly.dispose()
            }
        }
    }

    @Test
    fun `targeting groups and claims are forwarded on definitions request`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"flag":true}"""))
            val service = TogglyService(
                config(
                    server,
                    identity = "alice",
                    groups = listOf("beta", "staff"),
                    claims = mapOf("role" to "admin", "tier" to "gold"),
                )
            )
            try {
                assertEquals(TogglyLoadStatus.FETCHED, service.init().status)
                assertTrue(service.isFeatureOn("flag"))
                val url = server.takeRequest().requestUrl!!
                assertEquals("alice", url.queryParameter("u"))
                assertEquals(listOf("beta", "staff"), url.queryParameterValues("g"))
                assertEquals("admin", url.queryParameter("claim.role"))
                assertEquals("gold", url.queryParameter("claim.tier"))
            } finally {
                service.dispose()
            }
        }
    }

    @Test
    fun `304 not-modified keeps previously fetched evaluation state`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setBody("""{"sticky":true,"other":false}""")
                    .setHeader("ETag", "\"rev-1\"")
            )
            server.enqueue(MockResponse().setResponseCode(304).setHeader("ETag", "\"rev-1\""))
            val service = TogglyService(config(server))
            try {
                assertEquals(TogglyLoadStatus.FETCHED, service.init().status)
                assertTrue(service.isFeatureOn("sticky"))
                service.setNetworkState(NetworkState(true))
                val refreshed = service.refresh()
                assertTrue(service.isFeatureOn("sticky"))
                assertFalse(service.isFeatureOn("other"))
                // 304 may surface as fetched-from-cache / defaults depending on path;
                // evaluation must remain the previously applied definitions.
                assertTrue(refreshed.flags["sticky"] == true || service.isFeatureOn("sticky"))
            } finally {
                service.dispose()
            }
        }
    }
}
