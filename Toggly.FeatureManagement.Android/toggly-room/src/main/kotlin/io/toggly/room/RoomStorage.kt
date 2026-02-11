package io.toggly.room

import android.content.Context
import androidx.room.*
import io.toggly.core.models.TogglyStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Room entity for key-value storage.
 */
@Entity(tableName = "toggly_storage")
data class TogglyStorageEntity(
    @PrimaryKey
    val key: String,
    val value: String,
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * Room DAO for Toggly storage operations.
 */
@Dao
interface TogglyStorageDao {
    @Query("SELECT value FROM toggly_storage WHERE `key` = :key LIMIT 1")
    suspend fun get(key: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun set(entity: TogglyStorageEntity)

    @Query("DELETE FROM toggly_storage WHERE `key` = :key")
    suspend fun delete(key: String)

    @Query("DELETE FROM toggly_storage")
    suspend fun clear()

    @Query("SELECT `key` FROM toggly_storage")
    suspend fun getAllKeys(): List<String>

    @Query("SELECT COUNT(*) FROM toggly_storage")
    suspend fun count(): Int
}

/**
 * Room database for Toggly storage.
 */
@Database(
    entities = [TogglyStorageEntity::class],
    version = 1,
    exportSchema = false
)
abstract class TogglyDatabase : RoomDatabase() {
    abstract fun storageDao(): TogglyStorageDao

    companion object {
        @Volatile
        private var INSTANCE: TogglyDatabase? = null

        /**
         * Get the singleton database instance.
         *
         * @param context Application context
         * @param name Database name (default: "toggly.db")
         * @return TogglyDatabase instance
         */
        fun getInstance(
            context: Context,
            name: String = "toggly.db"
        ): TogglyDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    TogglyDatabase::class.java,
                    name
                )
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }

        /**
         * Clear the singleton instance (for testing).
         */
        internal fun clearInstance() {
            INSTANCE?.close()
            INSTANCE = null
        }
    }
}

/**
 * Room-based storage implementation for Toggly.
 * Provides persistent storage using Room database.
 *
 * @param database The Room database instance
 */
class RoomStorage(
    private val database: TogglyDatabase
) : TogglyStorage {

    private val dao: TogglyStorageDao = database.storageDao()

    /**
     * Create a RoomStorage from context.
     *
     * @param context Application context
     * @param databaseName Database name (default: "toggly.db")
     */
    constructor(
        context: Context,
        databaseName: String = "toggly.db"
    ) : this(TogglyDatabase.getInstance(context, databaseName))

    override suspend fun get(key: String): String? = withContext(Dispatchers.IO) {
        dao.get(key)
    }

    override suspend fun set(key: String, value: String) = withContext(Dispatchers.IO) {
        dao.set(TogglyStorageEntity(key, value))
    }

    override suspend fun delete(key: String) = withContext(Dispatchers.IO) {
        dao.delete(key)
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        dao.clear()
    }

    /**
     * Get all storage keys.
     */
    suspend fun keys(): List<String> = withContext(Dispatchers.IO) {
        dao.getAllKeys()
    }

    /**
     * Get the number of stored items.
     */
    suspend fun size(): Int = withContext(Dispatchers.IO) {
        dao.count()
    }
}

/**
 * Create a RoomStorage instance.
 *
 * @param context Application context
 * @param databaseName Database name (default: "toggly.db")
 * @return RoomStorage instance
 */
fun createRoomStorage(
    context: Context,
    databaseName: String = "toggly.db"
): RoomStorage {
    return RoomStorage(context, databaseName)
}
