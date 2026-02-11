package io.toggly.room

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [28])
class RoomStorageTest {

    private lateinit var database: TogglyDatabase
    private lateinit var storage: RoomStorage
    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, TogglyDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        storage = RoomStorage(database)
    }

    @After
    fun tearDown() {
        database.close()
        TogglyDatabase.clearInstance()
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
    fun `storage entity has correct properties`() {
        val entity = TogglyStorageEntity(
            key = "testKey",
            value = "testValue",
            updatedAt = 12345L
        )

        assertEquals("testKey", entity.key)
        assertEquals("testValue", entity.value)
        assertEquals(12345L, entity.updatedAt)
    }

    @Test
    fun `storage entity default updatedAt is set`() {
        val before = System.currentTimeMillis()
        val entity = TogglyStorageEntity(key = "key", value = "value")
        val after = System.currentTimeMillis()

        assertTrue(entity.updatedAt >= before)
        assertTrue(entity.updatedAt <= after)
    }

    @Test
    fun `storage entity equality`() {
        val entity1 = TogglyStorageEntity("key", "value", 100L)
        val entity2 = TogglyStorageEntity("key", "value", 100L)
        val entity3 = TogglyStorageEntity("key", "different", 100L)

        assertEquals(entity1, entity2)
        assertNotEquals(entity1, entity3)
    }

    @Test
    fun `storage entity copy`() {
        val original = TogglyStorageEntity("key", "value", 100L)
        val copy = original.copy(value = "newValue")

        assertEquals("key", copy.key)
        assertEquals("newValue", copy.value)
        assertEquals(100L, copy.updatedAt)
    }
}
