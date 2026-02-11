package io.toggly.core

import io.toggly.core.models.*
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TogglyServiceTest {

    private lateinit var service: TogglyService
    private lateinit var storage: MemoryStorage
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        storage = MemoryStorage()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createService(
        appKey: String? = "test-app-key",
        environment: String = "Production",
        featureDefaults: FeatureFlags = emptyMap(),
        refreshInterval: Long = 0
    ): TogglyService {
        val config = TogglyConfig(
            appKey = appKey,
            environment = environment,
            featureDefaults = featureDefaults,
            refreshInterval = refreshInterval,
            storage = storage
        )
        return TogglyService(config)
    }

    @Test
    fun `service initializes with default flags`() = runTest {
        val defaults = mapOf("feature1" to true, "feature2" to false)
        service = createService(featureDefaults = defaults)

        assertTrue(service.isFeatureOn("feature1"))
        assertFalse(service.isFeatureOn("feature2"))
    }

    @Test
    fun `isFeatureOn returns true for enabled feature`() = runTest {
        val defaults = mapOf("enabled-feature" to true)
        service = createService(featureDefaults = defaults)

        assertTrue(service.isFeatureOn("enabled-feature"))
    }

    @Test
    fun `isFeatureOn returns false for disabled feature`() = runTest {
        val defaults = mapOf("disabled-feature" to false)
        service = createService(featureDefaults = defaults)

        assertFalse(service.isFeatureOn("disabled-feature"))
    }

    @Test
    fun `isFeatureOn returns false for unknown feature`() = runTest {
        service = createService()

        assertFalse(service.isFeatureOn("unknown-feature"))
    }

    @Test
    fun `isFeatureOff returns opposite of isFeatureOn`() = runTest {
        val defaults = mapOf("enabled" to true, "disabled" to false)
        service = createService(featureDefaults = defaults)

        assertTrue(service.isFeatureOff("disabled"))
        assertFalse(service.isFeatureOff("enabled"))
        assertTrue(service.isFeatureOff("unknown"))
    }

    @Test
    fun `evaluateFeatureGate with ALL requirement - all enabled`() = runTest {
        val defaults = mapOf(
            "feature1" to true,
            "feature2" to true,
            "feature3" to true
        )
        service = createService(featureDefaults = defaults)

        val result = service.evaluateFeatureGate(
            listOf("feature1", "feature2", "feature3"),
            FeatureRequirement.ALL
        )

        assertTrue(result)
    }

    @Test
    fun `evaluateFeatureGate with ALL requirement - one disabled`() = runTest {
        val defaults = mapOf(
            "feature1" to true,
            "feature2" to false,
            "feature3" to true
        )
        service = createService(featureDefaults = defaults)

        val result = service.evaluateFeatureGate(
            listOf("feature1", "feature2", "feature3"),
            FeatureRequirement.ALL
        )

        assertFalse(result)
    }

    @Test
    fun `evaluateFeatureGate with ANY requirement - one enabled`() = runTest {
        val defaults = mapOf(
            "feature1" to false,
            "feature2" to true,
            "feature3" to false
        )
        service = createService(featureDefaults = defaults)

        val result = service.evaluateFeatureGate(
            listOf("feature1", "feature2", "feature3"),
            FeatureRequirement.ANY
        )

        assertTrue(result)
    }

    @Test
    fun `evaluateFeatureGate with ANY requirement - all disabled`() = runTest {
        val defaults = mapOf(
            "feature1" to false,
            "feature2" to false,
            "feature3" to false
        )
        service = createService(featureDefaults = defaults)

        val result = service.evaluateFeatureGate(
            listOf("feature1", "feature2", "feature3"),
            FeatureRequirement.ANY
        )

        assertFalse(result)
    }

    @Test
    fun `evaluateFeatureGate with negate - inverts result`() = runTest {
        val defaults = mapOf("feature1" to true)
        service = createService(featureDefaults = defaults)

        val result = service.evaluateFeatureGate(
            listOf("feature1"),
            FeatureRequirement.ALL,
            negate = true
        )

        assertFalse(result)
    }

    @Test
    fun `evaluateFeatureGate with empty list returns true for ALL`() = runTest {
        service = createService()

        val result = service.evaluateFeatureGate(
            emptyList(),
            FeatureRequirement.ALL
        )

        assertTrue(result)
    }

    @Test
    fun `evaluateFeatureGate with empty list returns true for ANY`() = runTest {
        service = createService()

        val result = service.evaluateFeatureGate(
            emptyList(),
            FeatureRequirement.ANY
        )

        // Empty list returns true unconditionally
        assertTrue(result)
    }

    @Test
    fun `featureFlagFlow emits current value`() = runTest {
        val defaults = mapOf("feature1" to true)
        service = createService(featureDefaults = defaults)

        val result = service.featureFlagFlow("feature1").first()
        assertTrue(result)
    }

    @Test
    fun `featureFlagFlow emits false for unknown feature`() = runTest {
        service = createService()

        val result = service.featureFlagFlow("unknown").first()
        assertFalse(result)
    }

    @Test
    fun `setIdentity updates current identity`() = runTest {
        service = createService()
        service.setIdentity("user-123")

        assertEquals("user-123", service.currentIdentity)
    }

    @Test
    fun `setIdentity with null uses device ID`() = runTest {
        service = createService()
        service.setIdentity("user-123")
        service.setIdentity(null)

        // When null is passed, service uses or generates device ID
        assertNotNull(service.currentIdentity)
        // Identity should not be the previously set value
        assertNotEquals("user-123", service.currentIdentity)
    }

    @Test
    fun `clearCache removes Toggly cache keys`() = runTest {
        service = createService()
        // Set a Toggly-specific cache key
        storage.set("@toggly:etag", "test-etag-value")

        service.clearCache()

        // Toggly cache keys should be cleared
        assertNull(storage.get("@toggly:etag"))
    }

    @Test
    fun `getDebugInfo returns current state`() = runTest {
        val defaults = mapOf("feature1" to true)
        service = createService(
            appKey = "test-key",
            environment = "staging",
            featureDefaults = defaults
        )
        service.setIdentity("user-123")

        val debugInfo = service.getDebugInfo()

        assertEquals("test-key", debugInfo.appKey)
        assertEquals("staging", debugInfo.environment)
        assertEquals("user-123", debugInfo.identity)
    }

    @Test
    fun `events flow is available`() = runTest {
        service = createService()

        // Just verify the flow exists and can be collected
        assertNotNull(service.events)
    }

    @Test
    fun `service with environment includes it in debug info`() = runTest {
        service = createService(environment = "staging")

        val debugInfo = service.getDebugInfo()
        assertEquals("staging", debugInfo.environment)
    }

    @Test
    fun `feature gate flow emits correct values`() = runTest {
        val defaults = mapOf(
            "feature1" to true,
            "feature2" to true
        )
        service = createService(featureDefaults = defaults)

        val result = service.featureGateFlow(
            listOf("feature1", "feature2"),
            FeatureRequirement.ALL
        ).first()

        assertTrue(result)
    }

    @Test
    fun `multiple features can be checked independently`() = runTest {
        val defaults = mapOf(
            "a" to true,
            "b" to false,
            "c" to true
        )
        service = createService(featureDefaults = defaults)

        assertTrue(service.isFeatureOn("a"))
        assertFalse(service.isFeatureOn("b"))
        assertTrue(service.isFeatureOn("c"))
    }

    @Test
    fun `default flags are used for evaluation when cache is empty`() = runTest {
        val defaults = mapOf("default-feature" to true)
        service = createService(featureDefaults = defaults)

        // Default flags are used for feature evaluation
        assertTrue(service.isFeatureOn("default-feature"))
    }

    @Test
    fun `service handles special characters in feature keys`() = runTest {
        val defaults = mapOf(
            "feature:with:colons" to true,
            "feature.with.dots" to true,
            "feature-with-dashes" to true,
            "feature_with_underscores" to true
        )
        service = createService(featureDefaults = defaults)

        assertTrue(service.isFeatureOn("feature:with:colons"))
        assertTrue(service.isFeatureOn("feature.with.dots"))
        assertTrue(service.isFeatureOn("feature-with-dashes"))
        assertTrue(service.isFeatureOn("feature_with_underscores"))
    }

    @Test
    fun `case sensitivity is maintained for feature keys`() = runTest {
        val defaults = mapOf(
            "Feature" to true,
            "feature" to false,
            "FEATURE" to true
        )
        service = createService(featureDefaults = defaults)

        assertTrue(service.isFeatureOn("Feature"))
        assertFalse(service.isFeatureOn("feature"))
        assertTrue(service.isFeatureOn("FEATURE"))
    }
}
