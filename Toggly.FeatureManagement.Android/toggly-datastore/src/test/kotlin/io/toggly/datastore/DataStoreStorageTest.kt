package io.toggly.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class DataStoreStorageTest {

    @get:Rule
    val tmpFolder: TemporaryFolder = TemporaryFolder.builder().assureDeletion().build()

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var testDataStore: DataStore<Preferences>
    private lateinit var storage: DataStoreStorage

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        testDataStore = PreferenceDataStoreFactory.create(
            scope = TestScope(testDispatcher + Job()),
            produceFile = { tmpFolder.newFile("test_prefs.preferences_pb") }
        )
        storage = DataStoreStorage(testDataStore)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `get returns null for non-existent key`() = runTest {
        val result = storage.get("non-existent")
        assertNull(result)
    }

    @Test
    fun `set and get returns stored value`() = runTest {
        storage.set("key1", "value1")
        val result = storage.get("key1")
        assertEquals("value1", result)
    }

    @Test
    fun `set overwrites existing value`() = runTest {
        storage.set("key1", "value1")
        storage.set("key1", "value2")
        val result = storage.get("key1")
        assertEquals("value2", result)
    }

    @Test
    fun `delete removes key`() = runTest {
        storage.set("key1", "value1")
        storage.delete("key1")
        val result = storage.get("key1")
        assertNull(result)
    }

    @Test
    fun `delete non-existent key does not throw`() = runTest {
        storage.delete("non-existent")
        // Should complete without exception
    }

    @Test
    fun `clear removes all keys`() = runTest {
        storage.set("key1", "value1")
        storage.set("key2", "value2")
        storage.set("key3", "value3")

        storage.clear()

        assertNull(storage.get("key1"))
        assertNull(storage.get("key2"))
        assertNull(storage.get("key3"))
    }

    @Test
    fun `keys returns all stored keys`() = runTest {
        storage.set("key1", "value1")
        storage.set("key2", "value2")
        storage.set("key3", "value3")

        val keys = storage.keys()

        assertEquals(3, keys.size)
        assertTrue(keys.contains("key1"))
        assertTrue(keys.contains("key2"))
        assertTrue(keys.contains("key3"))
    }

    @Test
    fun `keys returns empty list when storage is empty`() = runTest {
        val keys = storage.keys()
        assertTrue(keys.isEmpty())
    }

    @Test
    fun `size returns correct count`() = runTest {
        assertEquals(0, storage.size())

        storage.set("key1", "value1")
        assertEquals(1, storage.size())

        storage.set("key2", "value2")
        assertEquals(2, storage.size())

        storage.delete("key1")
        assertEquals(1, storage.size())
    }

    @Test
    fun `contains returns true for existing key`() = runTest {
        storage.set("key1", "value1")
        assertTrue(storage.contains("key1"))
    }

    @Test
    fun `contains returns false for non-existent key`() = runTest {
        assertFalse(storage.contains("non-existent"))
    }

    @Test
    fun `getMultiple returns values for existing keys`() = runTest {
        storage.set("key1", "value1")
        storage.set("key2", "value2")

        val result = storage.getMultiple(listOf("key1", "key2", "key3"))

        assertEquals("value1", result["key1"])
        assertEquals("value2", result["key2"])
        assertNull(result["key3"])
    }

    @Test
    fun `setMultiple sets all values`() = runTest {
        val entries = mapOf(
            "key1" to "value1",
            "key2" to "value2",
            "key3" to "value3"
        )

        storage.setMultiple(entries)

        assertEquals("value1", storage.get("key1"))
        assertEquals("value2", storage.get("key2"))
        assertEquals("value3", storage.get("key3"))
    }

    @Test
    fun `observe emits values`() = runTest {
        storage.set("key1", "initial")

        val flow = storage.observe("key1")
        assertEquals("initial", flow.first())
    }

    @Test
    fun `observe emits null for non-existent key`() = runTest {
        val flow = storage.observe("non-existent")
        assertNull(flow.first())
    }

    @Test
    fun `handles empty string key`() = runTest {
        storage.set("", "empty-key-value")
        assertEquals("empty-key-value", storage.get(""))
    }

    @Test
    fun `handles empty string value`() = runTest {
        storage.set("key", "")
        assertEquals("", storage.get("key"))
    }

    @Test
    fun `handles special characters in key and value`() = runTest {
        val key = "key:with/special\\chars@#\$%"
        val value = "value\nwith\ttabs\rand\nnewlines"

        storage.set(key, value)
        assertEquals(value, storage.get(key))
    }

    @Test
    fun `handles unicode characters`() = runTest {
        val key = "日本語キー"
        val value = "emoji: 🚀🎉 and more: 中文"

        storage.set(key, value)
        assertEquals(value, storage.get(key))
    }

    @Test
    fun `handles large values`() = runTest {
        val largeValue = "x".repeat(100_000)
        storage.set("large", largeValue)
        assertEquals(largeValue, storage.get("large"))
    }

    @Test
    fun `multiple operations maintain consistency`() = runTest {
        repeat(100) { i ->
            storage.set("key$i", "value$i")
        }

        repeat(50) { i ->
            storage.delete("key$i")
        }

        assertEquals(50, storage.size())

        repeat(50) { i ->
            assertNull(storage.get("key$i"))
        }

        (50 until 100).forEach { i ->
            assertEquals("value$i", storage.get("key$i"))
        }
    }

    @Test
    fun `getMultiple with empty list returns empty map`() = runTest {
        val result = storage.getMultiple(emptyList())
        assertTrue(result.isEmpty())
    }

    @Test
    fun `setMultiple with empty map does nothing`() = runTest {
        val initialSize = storage.size()
        storage.setMultiple(emptyMap())
        assertEquals(initialSize, storage.size())
    }

    @Test
    fun `setMultiple overwrites existing values`() = runTest {
        storage.set("key1", "old1")
        storage.set("key2", "old2")

        storage.setMultiple(mapOf("key1" to "new1", "key2" to "new2"))

        assertEquals("new1", storage.get("key1"))
        assertEquals("new2", storage.get("key2"))
    }
}
