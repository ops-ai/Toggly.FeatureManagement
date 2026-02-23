package io.toggly.core

import io.toggly.core.models.TogglyConfig
import io.toggly.core.storage.MemoryStorage
import org.junit.Assert.*
import org.junit.Test

class TogglyConfigTest {

    @Test
    fun `config with minimal parameters`() {
        val config = TogglyConfig(appKey = "test-key")

        assertEquals("test-key", config.appKey)
        assertEquals("https://definitions.toggly.io", config.baseUri)
        assertEquals("Production", config.environment)
        assertTrue(config.featureDefaults.isEmpty())
        assertEquals(180_000L, config.refreshInterval)
        assertFalse(config.useSignedDefinitions)
    }

    @Test
    fun `config with all parameters`() {
        val featureDefaults = mapOf("feature1" to true)
        val storage = MemoryStorage()
        val config = TogglyConfig(
            appKey = "my-key",
            baseUri = "https://custom.api.com",
            environment = "staging",
            identity = "user-123",
            featureDefaults = featureDefaults,
            showFeatureDuringEvaluation = true,
            refreshInterval = 30_000L,
            useSignedDefinitions = true,
            connectTimeout = 5_000L,
            requestTimeout = 15_000L,
            storage = storage
        )

        assertEquals("my-key", config.appKey)
        assertEquals("https://custom.api.com", config.baseUri)
        assertEquals("staging", config.environment)
        assertEquals("user-123", config.identity)
        assertEquals(featureDefaults, config.featureDefaults)
        assertTrue(config.showFeatureDuringEvaluation)
        assertEquals(30_000L, config.refreshInterval)
        assertTrue(config.useSignedDefinitions)
        assertEquals(5_000L, config.connectTimeout)
        assertEquals(15_000L, config.requestTimeout)
        assertEquals(storage, config.storage)
    }

    @Test
    fun `config copy works correctly`() {
        val original = TogglyConfig(appKey = "original-key")
        val copy = original.copy(appKey = "copied-key")

        assertEquals("original-key", original.appKey)
        assertEquals("copied-key", copy.appKey)
        assertEquals(original.baseUri, copy.baseUri)
    }

    @Test
    fun `config equality`() {
        val config1 = TogglyConfig(appKey = "key1")
        val config2 = TogglyConfig(appKey = "key1")
        val config3 = TogglyConfig(appKey = "key2")

        assertEquals(config1, config2)
        assertNotEquals(config1, config3)
    }

    @Test
    fun `config hashCode consistency`() {
        val config1 = TogglyConfig(appKey = "key1")
        val config2 = TogglyConfig(appKey = "key1")

        assertEquals(config1.hashCode(), config2.hashCode())
    }

    @Test
    fun `config with null app key`() {
        val config = TogglyConfig(appKey = null)
        assertNull(config.appKey)
    }

    @Test
    fun `config with empty app key`() {
        val config = TogglyConfig(appKey = "")
        assertEquals("", config.appKey)
    }

    @Test
    fun `config with long refresh interval`() {
        val config = TogglyConfig(
            appKey = "key",
            refreshInterval = Long.MAX_VALUE
        )
        assertEquals(Long.MAX_VALUE, config.refreshInterval)
    }

    @Test
    fun `config with zero refresh interval disables auto-refresh`() {
        val config = TogglyConfig(
            appKey = "key",
            refreshInterval = 0
        )
        assertEquals(0L, config.refreshInterval)
    }

    @Test
    fun `config feature defaults are accessible`() {
        val defaults = mapOf("feature1" to true, "feature2" to false)
        val config = TogglyConfig(
            appKey = "key",
            featureDefaults = defaults
        )

        assertTrue(config.featureDefaults["feature1"] == true)
        assertTrue(config.featureDefaults["feature2"] == false)
    }

    @Test
    fun `config toString contains appKey`() {
        val config = TogglyConfig(appKey = "my-app-key")
        val string = config.toString()

        assertTrue(string.contains("my-app-key"))
    }

    @Test
    fun `config with various environment values`() {
        val environments = listOf("Development", "Staging", "Production", "Test")

        environments.forEach { env ->
            val config = TogglyConfig(appKey = "key", environment = env)
            assertEquals(env, config.environment)
        }
    }

    @Test
    fun `config with special characters in appKey`() {
        val specialKey = "key-with_special.chars:123"
        val config = TogglyConfig(appKey = specialKey)
        assertEquals(specialKey, config.appKey)
    }

    @Test
    fun `config baseUri variations`() {
        val uris = listOf(
            "https://api.toggly.io",
            "https://custom.domain.com",
            "http://localhost:3000",
            "https://api.toggly.io/v2"
        )

        uris.forEach { uri ->
            val config = TogglyConfig(appKey = "key", baseUri = uri)
            assertEquals(uri, config.baseUri)
        }
    }

    @Test
    fun `config with identity`() {
        val config = TogglyConfig(
            appKey = "key",
            identity = "user-456"
        )
        assertEquals("user-456", config.identity)
    }

    @Test
    fun `config with null identity uses device ID`() {
        val config = TogglyConfig(
            appKey = "key",
            identity = null
        )
        assertNull(config.identity)
    }

    @Test
    fun `config timeout defaults`() {
        val config = TogglyConfig(appKey = "key")
        assertEquals(10_000L, config.connectTimeout)
        assertEquals(30_000L, config.requestTimeout)
    }

    @Test
    fun `config showFeatureDuringEvaluation default is false`() {
        val config = TogglyConfig(appKey = "key")
        assertFalse(config.showFeatureDuringEvaluation)
    }

    @Test
    fun `config with custom storage`() {
        val storage = MemoryStorage()
        val config = TogglyConfig(
            appKey = "key",
            storage = storage
        )
        assertEquals(storage, config.storage)
    }
}
