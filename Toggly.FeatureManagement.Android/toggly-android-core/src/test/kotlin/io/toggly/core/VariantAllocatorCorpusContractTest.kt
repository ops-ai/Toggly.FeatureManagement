package io.toggly.core

import io.toggly.core.models.TogglyConfig
import io.toggly.core.models.TogglyLoadStatus
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Replays `variant-allocator-corpus/cases.json` against the Android **client**
 * variants rail: mocked `evaluated-variants-signed` payloads shaped like the
 * corpus `expected` assignment.
 *
 * Android assigns variants from the server response (same dual-rail as Flutter /
 * JS). It does **not** implement Microsoft.FeatureManagement catalog-local
 * allocation. This suite proves public `getVariant` / `getVariantValue` /
 * `isFeatureOn` honor those evaluated assignments.
 *
 * KNOWN FAILURE: when `expected.enabled == false` but `expected.variantName`
 * is non-null (DefaultWhenDisabled / statusOverride), Microsoft.FeatureManagement
 * still reports the variant. Android/Flutter/JS `getVariant` returns null for
 * disabled features even when variant metadata is present. Those cases assert
 * the disabled flag and skip the variant identity assertion (see
 * [VariantsTest] `getVariant returns null when feature is disabled even with
 * variant metadata`).
 *
 * KNOWN LIMITATION (owner decision): local catalog allocation parity would be a
 * new engine; do not change public API to invent client-side allocation here.
 */
@RunWith(Parameterized::class)
class VariantAllocatorCorpusContractTest(private val case: CorpusCase) {

    data class CorpusCase(
        val id: String,
        val featureName: String,
        val identity: String?,
        val groups: List<String>,
        val expectedEnabled: Boolean,
        val expectedVariant: String?,
        val expectedConfiguration: Any?,
        val configurationJson: String?,
    ) {
        override fun toString(): String = id
    }

    @Test
    fun `evaluated variant assignment matches corpus expected through public API`() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody(buildVariantPayload(case)))
            val service = TogglyService(
                TogglyConfig(
                    appKey = "corpus-app",
                    environment = "Production",
                    baseUri = server.url("/").toString(),
                    identity = case.identity,
                    groups = case.groups,
                    enableVariants = true,
                    enableTelemetry = false,
                    enableLiveUpdates = false,
                    refreshInterval = 0,
                    storage = MemoryStorage(),
                )
            )
            try {
                assertEquals(TogglyLoadStatus.FETCHED, service.init().status)
                assertEquals(
                    "corpus ${case.id}: enabled state",
                    case.expectedEnabled,
                    service.isFeatureOn(case.featureName)
                )

                if (!case.expectedEnabled && case.expectedVariant != null) {
                    // KNOWN FAILURE vs MF corpus: disabled features hide variants.
                    assertNull(
                        "KNOWN FAILURE (${case.id}): Android hides variants when disabled; " +
                            "MF corpus expects variant=${case.expectedVariant}",
                        service.getVariant(case.featureName)
                    )
                } else if (case.expectedVariant == null) {
                    assertNull(service.getVariant(case.featureName))
                    assertNull(service.getVariantValue(case.featureName))
                } else {
                    assumeTrue(
                        "enabled assignment requires enabled=true",
                        case.expectedEnabled
                    )
                    val variant = service.getVariant(case.featureName)
                    assertNotNull("corpus ${case.id}", variant)
                    assertEquals(case.expectedVariant, variant!!.name)
                    assertEquals(case.expectedConfiguration, variant.configurationValue)
                    assertEquals(case.expectedConfiguration, service.getVariantValue(case.featureName))
                }

                val url = server.takeRequest().requestUrl!!
                assertEquals(
                    "/evaluated-variants-signed/corpus-app/Production",
                    url.encodedPath
                )
                if (case.identity != null) {
                    assertEquals(case.identity, url.queryParameter("u"))
                }
                assertEquals(case.groups, url.queryParameterValues("g"))
            } finally {
                service.dispose()
            }
        }
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }

        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun cases(): Collection<CorpusCase> {
            val file = resolveCorpusFile()
            assertNotNull("variant-allocator-corpus/cases.json not found", file)
            val root = json.parseToJsonElement(Files.readString(file)).jsonArray
            return root.map { element ->
                val obj = element.jsonObject
                val feature = obj.getValue("feature").jsonObject
                val targeting = obj["targeting"]?.jsonObject
                val expected = obj.getValue("expected").jsonObject
                val groups = targeting?.get("groups")?.jsonArray?.mapNotNull {
                    it.jsonPrimitive.contentOrNull
                }.orEmpty()
                val configurationElement = expected["configurationValue"]
                CorpusCase(
                    id = obj.getValue("id").jsonPrimitive.content,
                    featureName = feature.getValue("name").jsonPrimitive.content,
                    identity = targeting?.get("userId")?.let {
                        if (it is JsonNull) null else it.jsonPrimitive.contentOrNull
                    },
                    groups = groups,
                    expectedEnabled = expected.getValue("enabled").jsonPrimitive.boolean,
                    expectedVariant = expected["variantName"]?.let {
                        if (it is JsonNull) null else it.jsonPrimitive.contentOrNull
                    },
                    expectedConfiguration = configurationElement?.let(::jsonToKotlin),
                    configurationJson = configurationElement?.toString(),
                )
            }
        }

        private fun buildVariantPayload(case: CorpusCase): String {
            val enabled = case.expectedEnabled
            val variant = case.expectedVariant
            return if (variant == null) {
                """{"${case.featureName}":{"enabled":$enabled}}"""
            } else {
                val configJson = case.configurationJson ?: "null"
                val quotedVariant = Json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(variant))
                """{"${case.featureName}":{"enabled":$enabled,"variant":$quotedVariant,"configurationValue":$configJson}}"""
            }
        }

        private fun jsonToKotlin(element: JsonElement): Any? = when (element) {
            is JsonNull -> null
            is JsonObject -> element.mapValues { (_, value) -> jsonToKotlin(value) }
            is JsonArray -> element.map { jsonToKotlin(it) }
            is JsonPrimitive -> when {
                element.isString -> element.content
                else -> element.booleanOrNull
                    ?: element.longOrNull
                    ?: element.doubleOrNull
                    ?: element.content
            }
        }

        private fun resolveCorpusFile(): Path? {
            val cwd = Paths.get("").toAbsolutePath()
            val candidates = listOf(
                cwd.resolve("variant-allocator-corpus/cases.json"),
                cwd.resolve("../variant-allocator-corpus/cases.json"),
                cwd.resolve("../../variant-allocator-corpus/cases.json"),
                cwd.resolve("../../../variant-allocator-corpus/cases.json"),
            )
            candidates.firstOrNull { Files.isRegularFile(it) }?.let { return it.normalize() }
            var walk: Path? = cwd
            while (walk != null) {
                val candidate = walk.resolve("variant-allocator-corpus/cases.json")
                if (Files.isRegularFile(candidate)) return candidate.normalize()
                walk = walk.parent
            }
            return null
        }
    }
}
