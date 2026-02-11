package io.toggly.core.storage

import io.toggly.core.models.TogglyStorage
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * In-memory storage implementation.
 * Data is not persisted across app restarts.
 */
class MemoryStorage : TogglyStorage {
    private val storage = mutableMapOf<String, String>()
    private val mutex = Mutex()

    override suspend fun get(key: String): String? = mutex.withLock {
        storage[key]
    }

    override suspend fun set(key: String, value: String) = mutex.withLock {
        storage[key] = value
    }

    override suspend fun delete(key: String) = mutex.withLock {
        storage.remove(key)
        Unit
    }

    override suspend fun clear() = mutex.withLock {
        storage.clear()
    }

    /**
     * Get all keys in storage.
     */
    suspend fun keys(): Set<String> = mutex.withLock {
        storage.keys.toSet()
    }

    /**
     * Get the number of items in storage.
     */
    suspend fun size(): Int = mutex.withLock {
        storage.size
    }
}
