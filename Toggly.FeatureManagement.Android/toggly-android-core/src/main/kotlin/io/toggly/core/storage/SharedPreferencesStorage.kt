package io.toggly.core.storage

import android.content.Context
import android.content.SharedPreferences
import io.toggly.core.models.TogglyStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/**
 * SharedPreferences-based storage implementation.
 * Provides simple persistent storage using Android SharedPreferences.
 *
 * @param context Android application context
 * @param preferencesName Name of the preferences file (default: "toggly_prefs")
 */
class SharedPreferencesStorage(
    context: Context,
    preferencesName: String = "toggly_prefs"
) : TogglyStorage {

    private val preferences: SharedPreferences =
        context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    private val mutex = Mutex()

    override suspend fun get(key: String): String? = mutex.withLock {
        withContext(Dispatchers.IO) {
            preferences.getString(key, null)
        }
    }

    override suspend fun set(key: String, value: String) = mutex.withLock {
        withContext(Dispatchers.IO) {
            preferences.edit().putString(key, value).apply()
        }
    }

    override suspend fun delete(key: String) = mutex.withLock {
        withContext(Dispatchers.IO) {
            preferences.edit().remove(key).apply()
        }
    }

    override suspend fun clear() = mutex.withLock {
        withContext(Dispatchers.IO) {
            preferences.edit().clear().apply()
        }
    }

    /**
     * Get all keys in storage.
     */
    suspend fun keys(): Set<String> = mutex.withLock {
        withContext(Dispatchers.IO) {
            preferences.all.keys
        }
    }

    /**
     * Check if a key exists.
     */
    suspend fun contains(key: String): Boolean = mutex.withLock {
        withContext(Dispatchers.IO) {
            preferences.contains(key)
        }
    }
}
