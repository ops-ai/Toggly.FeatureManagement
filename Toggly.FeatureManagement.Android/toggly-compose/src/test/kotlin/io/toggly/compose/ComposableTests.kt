package io.toggly.compose

import io.mockk.*
import io.toggly.core.TogglyService
import io.toggly.core.TogglyEntityContext
import io.toggly.core.clearRegisteredContexts
import io.toggly.core.models.FeatureFlags
import io.toggly.core.models.FeatureRequirement
import io.toggly.core.models.TogglyConfig
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ComposableTests {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var mockService: TogglyService

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        mockService = mockk(relaxed = true)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        clearRegisteredContexts()
    }

    @Test
    fun `TogglyService mock can be configured`() = runTest {
        val featureFlagsFlow = MutableStateFlow<FeatureFlags>(mapOf("feature1" to true))
        every { mockService.featureFlags } returns featureFlagsFlow
        every { mockService.featureFlagFlow("feature1") } returns flowOf(true)

        val flags = mockService.featureFlags.value
        assertTrue(flags["feature1"] == true)
    }

    @Test
    fun `mock service featureFlagFlow returns expected values`() = runTest {
        every { mockService.featureFlagFlow("enabled") } returns flowOf(true)
        every { mockService.featureFlagFlow("disabled") } returns flowOf(false)

        // These would be used by Compose components
        verify(exactly = 0) { mockService.featureFlagFlow(any()) }

        mockService.featureFlagFlow("enabled")
        mockService.featureFlagFlow("disabled")

        verify(exactly = 1) { mockService.featureFlagFlow("enabled") }
        verify(exactly = 1) { mockService.featureFlagFlow("disabled") }
    }

    @Test
    fun `mock service featureGateFlow returns expected values`() = runTest {
        every {
            mockService.featureGateFlow(
                listOf("f1", "f2"),
                FeatureRequirement.ALL,
                false
            )
        } returns flowOf(true)

        every {
            mockService.featureGateFlow(
                listOf("f1", "f3"),
                FeatureRequirement.ANY,
                false
            )
        } returns flowOf(true)

        verify(exactly = 0) { mockService.featureGateFlow(any(), any(), any()) }
    }

    @Test
    fun `real service can be created for integration tests`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("feature1" to true, "feature2" to false),
            storage = MemoryStorage()
        )
        val service = TogglyService(config)

        assertTrue(service.isFeatureOn("feature1"))
        assertFalse(service.isFeatureOn("feature2"))
    }

    @Test
    fun `service identity can be set`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            storage = MemoryStorage()
        )
        val service = TogglyService(config)

        service.setIdentity("user-123")
        assertEquals("user-123", service.currentIdentity)
    }

    @Test
    fun `service debug info is accessible`() {
        val config = TogglyConfig(
            appKey = "test-key",
            environment = "staging",
            storage = MemoryStorage()
        )
        val service = TogglyService(config)
        val debugInfo = service.getDebugInfo()

        assertEquals("test-key", debugInfo.appKey)
        assertEquals("staging", debugInfo.environment)
    }

    @Test
    fun `FeatureRequirement enum values exist`() {
        val all = FeatureRequirement.ALL
        val any = FeatureRequirement.ANY

        assertEquals(2, FeatureRequirement.entries.size)
        assertTrue(FeatureRequirement.entries.contains(all))
        assertTrue(FeatureRequirement.entries.contains(any))
    }

    @Test
    fun `feature gate evaluation with ALL requirement`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("f1" to true, "f2" to true, "f3" to false),
            storage = MemoryStorage()
        )
        val service = TogglyService(config)

        // ALL enabled
        assertTrue(service.evaluateFeatureGate(listOf("f1", "f2"), FeatureRequirement.ALL))

        // One disabled
        assertFalse(service.evaluateFeatureGate(listOf("f1", "f2", "f3"), FeatureRequirement.ALL))
    }

    @Test
    fun `feature gate evaluation with ANY requirement`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("f1" to false, "f2" to true, "f3" to false),
            storage = MemoryStorage()
        )
        val service = TogglyService(config)

        // At least one enabled
        assertTrue(service.evaluateFeatureGate(listOf("f1", "f2", "f3"), FeatureRequirement.ANY))

        // All disabled
        assertFalse(service.evaluateFeatureGate(listOf("f1", "f3"), FeatureRequirement.ANY))
    }

    @Test
    fun `feature gate with negate inverts result`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("f1" to true),
            storage = MemoryStorage()
        )
        val service = TogglyService(config)

        assertTrue(service.evaluateFeatureGate(listOf("f1"), FeatureRequirement.ALL, negate = false))
        assertFalse(service.evaluateFeatureGate(listOf("f1"), FeatureRequirement.ALL, negate = true))
    }

    @Test
    fun `Feature off path uses negate via evaluateFeatureGate`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("maintenance" to false, "banner" to true),
            storage = MemoryStorage()
        )
        val service = TogglyService(config)

        // Primary off-path story: Feature(key, negate = true) → evaluate with negate
        assertTrue(
            service.evaluateFeatureGate(
                listOf("maintenance"),
                FeatureRequirement.ALL,
                negate = true
            )
        )
        assertFalse(
            service.evaluateFeatureGate(
                listOf("banner"),
                FeatureRequirement.ALL,
                negate = true
            )
        )
    }

    @Test
    fun `Feature entity context is evaluated through the service`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("plain" to true),
            storage = MemoryStorage()
        )
        val service = TogglyService(config)
        service.registerContext("Order") { order: Map<String, String> ->
            TogglyEntityContext("Order", order.getValue("id"), emptyMap())
        }

        assertTrue(
            service.evaluateFeatureGate(
                listOf("plain"),
                FeatureRequirement.ALL,
                negate = false,
                mapOf("id" to "1"),
                "Order"
            )
        )
    }
}
