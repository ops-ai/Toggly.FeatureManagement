package io.toggly.core

import io.toggly.core.models.TogglyConfig
import io.toggly.core.models.TogglyLoadStatus
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Replays shared `docs/filter-parity/fixtures` against the Android **client**
 * API contract: the definitions service returns already-evaluated booleans for
 * server-side filters (Percentage, Targeting, UserClaims, UA filters, …).
 *
 * Android does **not** locally evaluate those filter catalogs (unlike Java /
 * Node / Python eval engines). This suite asserts that when the mocked
 * `evaluated-signed` payload matches each fixture's `expected` result and the
 * fixture context is supplied as targeting query inputs, public entry points
 * surface that result.
 *
 * KNOWN LIMITATION (owner decision): catalog-local filter parity for Android
 * would require a new local evaluation engine; do not change public API or
 * evaluation behavior here to fake local filter execution.
 */
@RunWith(Parameterized::class)
class FilterParityFixturesContractTest(private val fixture: FixtureCase) {

    data class FixtureCase(
        val id: String,
        val description: String,
        val featureKey: String,
        val expected: Boolean,
        val identity: String?,
        val groups: List<String>,
        val claims: Map<String, String>,
    ) {
        override fun toString(): String = id
    }

    @Test
    fun `evaluated definitions match fixture expected through public API`() = runBlocking {
        MockWebServer().use { server ->
            val body = """{"${fixture.featureKey}":${fixture.expected}}"""
            server.enqueue(MockResponse().setBody(body))
            val service = TogglyService(
                TogglyConfig(
                    appKey = "parity-app",
                    environment = "Production",
                    baseUri = server.url("/").toString(),
                    identity = fixture.identity,
                    groups = fixture.groups,
                    claims = fixture.claims,
                    enableTelemetry = false,
                    enableLiveUpdates = false,
                    refreshInterval = 0,
                    storage = MemoryStorage(),
                )
            )
            try {
                val init = service.init()
                assertEquals(
                    "fixture ${fixture.id}: ${fixture.description}",
                    TogglyLoadStatus.FETCHED,
                    init.status
                )
                assertEquals(
                    "fixture ${fixture.id}: ${fixture.description}",
                    fixture.expected,
                    service.isFeatureOn(fixture.featureKey)
                )
                assertEquals(fixture.expected, service.isFeatureEnabled(fixture.featureKey))
                assertEquals(!fixture.expected, service.isFeatureOff(fixture.featureKey))

                val url = server.takeRequest().requestUrl!!
                assertEquals("/evaluated-signed/parity-app/Production", url.encodedPath)
                if (fixture.identity != null) {
                    assertEquals(fixture.identity, url.queryParameter("u"))
                }
                assertEquals(fixture.groups, url.queryParameterValues("g"))
                for ((claim, value) in fixture.claims) {
                    assertEquals(value, url.queryParameter("claim.$claim"))
                }
            } finally {
                service.dispose()
            }
        }
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        private val REQUIRED_IDS = setOf(
            "browser-family-match",
            "browser-family-miss",
            "browser-language-match",
            "country-from-request",
            "country-from-cf-ipcountry",
            "device-type-match",
            "os-match",
            "user-claims-match",
            "user-claims-miss",
            "targeting-groups-match",
            "percentage-missing-fail-closed",
            "percentage-zero-fail-closed",
            "unknown-filter-fail-closed",
        )

        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun fixtures(): Collection<FixtureCase> {
            val dir = resolveFixturesDir()
            assertNotNull("docs/filter-parity/fixtures not found", dir)
            val cases = Files.newDirectoryStream(dir, "*.json").use { stream ->
                stream.map { path ->
                    val root = json.parseToJsonElement(Files.readString(path)).jsonObject
                    val context = root["context"]?.jsonObject
                    val identity = context?.get("identity")?.jsonPrimitive?.contentOrNull
                    val groups = context?.get("groups")?.jsonArray?.mapNotNull {
                        it.jsonPrimitive.contentOrNull
                    }.orEmpty()
                    val claims = linkedMapOf<String, String>()
                    context?.get("claims")?.jsonObject?.forEach { (key, value) ->
                        value.jsonPrimitive.contentOrNull?.let { claims[key] = it }
                    }
                    FixtureCase(
                        id = root.getValue("id").jsonPrimitive.content,
                        description = root["description"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        featureKey = root.getValue("featureKey").jsonPrimitive.content,
                        expected = root.getValue("expected").jsonPrimitive.boolean,
                        identity = identity,
                        groups = groups,
                        claims = claims,
                    )
                }.sortedBy { it.id }
            }
            val ids = cases.map { it.id }.toSet()
            for (required in REQUIRED_IDS) {
                assertTrue("missing fixture $required", ids.contains(required))
            }
            return cases
        }

        private fun resolveFixturesDir(): Path? {
            val cwd = Paths.get("").toAbsolutePath()
            val candidates = listOf(
                cwd.resolve("docs/filter-parity/fixtures"),
                cwd.resolve("../docs/filter-parity/fixtures"),
                cwd.resolve("../../docs/filter-parity/fixtures"),
                cwd.resolve("../../../docs/filter-parity/fixtures"),
            )
            candidates.firstOrNull { Files.isDirectory(it) }?.let { return it.normalize() }
            var walk: Path? = cwd
            while (walk != null) {
                val candidate = walk.resolve("docs/filter-parity/fixtures")
                if (Files.isDirectory(candidate)) return candidate.normalize()
                walk = walk.parent
            }
            return null
        }
    }
}
