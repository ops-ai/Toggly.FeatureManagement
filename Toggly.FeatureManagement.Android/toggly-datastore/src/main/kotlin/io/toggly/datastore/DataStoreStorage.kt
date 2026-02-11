package io.toggly.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import io.toggly.core.models.TogglyStorage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/**
 * DataStore extension for Toggly storage.
 */
private val Context.togglyDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "toggly_preferences"
)

/**
 * DataStore-based storage implementation for Toggly.
 * Provides modern, coroutine-friendly persistent storage using AndroidX DataStore.
 *
 * Benefits over SharedPreferences:
 * - Fully async and coroutine-based
 * - Type-safe with no runtime exceptions
 * - Consistency guarantees
 * - Handles data migration
 *
 * @param dataStore The DataStore instance to use
 */
class DataStoreStorage(
    private val dataStore: DataStore<Preferences>
) : TogglyStorage {

    /**
     * Create DataStoreStorage from context.
     *
     * @param context Application context
     */
    constructor(context: Context) : this(context.togglyDataStore)

    override suspend fun get(key: String): String? {
        val prefKey = stringPreferencesKey(key)
        return dataStore.data.first()[prefKey]
    }

    override suspend fun set(key: String, value: String) {
        val prefKey = stringPreferencesKey(key)
        dataStore.edit { preferences ->
            preferences[prefKey] = value
        }
    }

    override suspend fun delete(key: String) {
        val prefKey = stringPreferencesKey(key)
        dataStore.edit { preferences ->
            preferences.remove(prefKey)
        }
    }

    override suspend fun clear() {
        dataStore.edit { preferences ->
            preferences.clear()
        }
    }

    /**
     * Observe a specific key as a Flow.
     *
     * @param key The key to observe
     * @return Flow emitting the current value
     */
    fun observe(key: String): Flow<String?> {
        val prefKey = stringPreferencesKey(key)
        return dataStore.data.map { preferences ->
            preferences[prefKey]
        }
    }

    /**
     * Get all keys stored in DataStore.
     *
     * @return List of all keys
     */
    suspend fun keys(): List<String> {
        return dataStore.data.first().asMap().keys.map { it.name }
    }

    /**
     * Get the number of stored items.
     *
     * @return Number of items
     */
    suspend fun size(): Int {
        return dataStore.data.first().asMap().size
    }

    /**
     * Check if a key exists.
     *
     * @param key The key to check
     * @return Whether the key exists
     */
    suspend fun contains(key: String): Boolean {
        val prefKey = stringPreferencesKey(key)
        return dataStore.data.first().contains(prefKey)
    }

    /**
     * Get multiple values at once.
     *
     * @param keys List of keys to retrieve
     * @return Map of key to value
     */
    suspend fun getMultiple(keys: List<String>): Map<String, String?> {
        val preferences = dataStore.data.first()
        return keys.associateWith { key ->
            preferences[stringPreferencesKey(key)]
        }
    }

    /**
     * Set multiple values at once.
     *
     * @param entries Map of key to value
     */
    suspend fun setMultiple(entries: Map<String, String>) {
        dataStore.edit { preferences ->
            entries.forEach { (key, value) ->
                preferences[stringPreferencesKey(key)] = value
            }
        }
    }
}

/**
 * Create a DataStoreStorage instance.
 *
 * @param context Application context
 * @return DataStoreStorage instance
 */
fun createDataStoreStorage(context: Context): DataStoreStorage {
    return DataStoreStorage(context)
}

/**
 * Extension function to get Toggly DataStore from context.
 */
val Context.togglyStorage: DataStoreStorage
    get() = DataStoreStorage(this)
