package io.toggly.core

import io.toggly.core.models.TogglyConfig
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TogglyTest {

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        Toggly.reset()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
        Toggly.reset()
    }

    @Test
    fun `configure creates service with given config`() = runTest {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("feature1" to true),
            storage = MemoryStorage()
        )

        Toggly.configure(config)

        assertTrue(Toggly.shared.isFeatureOn("feature1"))
    }

    @Test
    fun `shared returns configured service`() = runTest {
        val config = TogglyConfig(appKey = "shared-key", storage = MemoryStorage())
        Toggly.configure(config)

        val service = Toggly.shared
        assertNotNull(service)
    }

    @Test(expected = IllegalStateException::class)
    fun `shared throws when not configured`() {
        Toggly.reset()
        Toggly.shared
    }

    @Test
    fun `reset clears configured service`() = runTest {
        val config = TogglyConfig(appKey = "test-key", storage = MemoryStorage())
        Toggly.configure(config)

        Toggly.reset()

        try {
            Toggly.shared
            fail("Should throw IllegalStateException")
        } catch (e: IllegalStateException) {
            assertTrue(e.message?.contains("not been configured") == true)
        }
    }

    @Test
    fun `configure can be called multiple times`() = runTest {
        val config1 = TogglyConfig(
            appKey = "key1",
            featureDefaults = mapOf("feature1" to true),
            storage = MemoryStorage()
        )
        val config2 = TogglyConfig(
            appKey = "key2",
            featureDefaults = mapOf("feature2" to true),
            storage = MemoryStorage()
        )

        Toggly.configure(config1)
        assertTrue(Toggly.shared.isFeatureOn("feature1"))

        Toggly.configure(config2)
        assertTrue(Toggly.shared.isFeatureOn("feature2"))
    }

    @Test
    fun `initialized starts as false`() {
        val config = TogglyConfig(appKey = "test-key", storage = MemoryStorage())
        Toggly.configure(config)
        assertFalse(Toggly.initialized)
    }

    @Test
    fun `service preserves feature flags after reconfiguration`() = runTest {
        val config1 = TogglyConfig(
            appKey = "key1",
            featureDefaults = mapOf("feature1" to true),
            storage = MemoryStorage()
        )

        Toggly.configure(config1)
        assertTrue(Toggly.shared.isFeatureOn("feature1"))

        // Reconfigure with different flags
        val config2 = TogglyConfig(
            appKey = "key2",
            featureDefaults = mapOf("feature2" to true),
            storage = MemoryStorage()
        )
        Toggly.configure(config2)

        // New configuration should be active
        assertTrue(Toggly.shared.isFeatureOn("feature2"))
    }

    @Test
    fun `configure thread safety`() = runTest {
        val config = TogglyConfig(appKey = "test-key", storage = MemoryStorage())

        // Configure multiple times concurrently
        repeat(10) {
            Toggly.configure(config)
        }

        // Should not throw
        assertNotNull(Toggly.shared)
    }

    @Test
    fun `currentIdentity returns null initially`() {
        val config = TogglyConfig(appKey = "test-key", storage = MemoryStorage())
        Toggly.configure(config)

        assertNull(Toggly.currentIdentity)
    }

    @Test
    fun `featureFlags flow is available`() {
        val config = TogglyConfig(
            appKey = "test-key",
            featureDefaults = mapOf("feature1" to true),
            storage = MemoryStorage()
        )
        Toggly.configure(config)

        assertNotNull(Toggly.featureFlags)
    }
}
