package io.toggly.core

import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class MemoryStorageTest {

    private lateinit var storage: MemoryStorage

    @Before
    fun setup() {
        storage = MemoryStorage()
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
    fun `keys returns empty set when storage is empty`() = runTest {
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
    fun `key exists after set`() = runTest {
        storage.set("key1", "value1")
        val keys = storage.keys()
        assertTrue(keys.contains("key1"))
    }

    @Test
    fun `key does not exist after delete`() = runTest {
        storage.set("key1", "value1")
        storage.delete("key1")
        val keys = storage.keys()
        assertFalse(keys.contains("key1"))
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
}
