//! In-memory caching for feature evaluations.

use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// A cached value with expiration.
#[derive(Debug, Clone)]
struct CacheEntry<T> {
    value: T,
    expires_at: Instant,
}

impl<T> CacheEntry<T> {
    fn new(value: T, ttl: Duration) -> Self {
        Self {
            value,
            expires_at: Instant::now() + ttl,
        }
    }

    fn is_expired(&self) -> bool {
        Instant::now() > self.expires_at
    }
}

/// Thread-safe in-memory cache with TTL support.
#[derive(Debug, Clone)]
pub struct Cache<T> {
    inner: Arc<DashMap<String, CacheEntry<T>>>,
    ttl: Duration,
    max_entries: usize,
}

impl<T: Clone> Cache<T> {
    /// Create a new cache with the specified TTL and max entries.
    pub fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
            ttl,
            max_entries,
        }
    }

    /// Get a value from the cache.
    pub fn get(&self, key: &str) -> Option<T> {
        let entry = self.inner.get(key)?;
        if entry.is_expired() {
            drop(entry);
            self.inner.remove(key);
            return None;
        }
        Some(entry.value.clone())
    }

    /// Insert a value into the cache.
    pub fn insert(&self, key: String, value: T) {
        // Evict expired entries if we're at capacity
        if self.inner.len() >= self.max_entries {
            self.evict_expired();
        }

        // If still at capacity, remove oldest entries
        if self.inner.len() >= self.max_entries {
            // Remove ~10% of entries
            let to_remove = self.max_entries / 10;
            let keys: Vec<String> = self
                .inner
                .iter()
                .take(to_remove)
                .map(|e| e.key().clone())
                .collect();
            for key in keys {
                self.inner.remove(&key);
            }
        }

        self.inner.insert(key, CacheEntry::new(value, self.ttl));
    }

    /// Remove a value from the cache.
    pub fn remove(&self, key: &str) -> Option<T> {
        self.inner.remove(key).map(|(_, entry)| entry.value)
    }

    /// Clear all entries from the cache.
    pub fn clear(&self) {
        self.inner.clear();
    }

    /// Get the number of entries in the cache.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Check if the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Evict all expired entries.
    pub fn evict_expired(&self) {
        let expired_keys: Vec<String> = self
            .inner
            .iter()
            .filter(|entry| entry.is_expired())
            .map(|entry| entry.key().clone())
            .collect();

        for key in expired_keys {
            self.inner.remove(&key);
        }
    }
}

impl<T: Clone> Default for Cache<T> {
    fn default() -> Self {
        Self::new(Duration::from_secs(60), 10_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn test_cache_basic_operations() {
        let cache: Cache<bool> = Cache::new(Duration::from_secs(60), 100);

        cache.insert("key1".to_string(), true);
        cache.insert("key2".to_string(), false);

        assert_eq!(cache.get("key1"), Some(true));
        assert_eq!(cache.get("key2"), Some(false));
        assert_eq!(cache.get("key3"), None);

        assert_eq!(cache.len(), 2);
        assert!(!cache.is_empty());
    }

    #[test]
    fn test_cache_expiration() {
        let cache: Cache<bool> = Cache::new(Duration::from_millis(50), 100);

        cache.insert("key1".to_string(), true);
        assert_eq!(cache.get("key1"), Some(true));

        sleep(Duration::from_millis(100));
        assert_eq!(cache.get("key1"), None);
    }

    #[test]
    fn test_cache_remove() {
        let cache: Cache<bool> = Cache::new(Duration::from_secs(60), 100);

        cache.insert("key1".to_string(), true);
        assert_eq!(cache.remove("key1"), Some(true));
        assert_eq!(cache.get("key1"), None);
    }

    #[test]
    fn test_cache_clear() {
        let cache: Cache<bool> = Cache::new(Duration::from_secs(60), 100);

        cache.insert("key1".to_string(), true);
        cache.insert("key2".to_string(), false);
        cache.clear();

        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_max_entries() {
        let cache: Cache<i32> = Cache::new(Duration::from_secs(60), 10);

        for i in 0..20 {
            cache.insert(format!("key{}", i), i);
        }

        // Cache should have evicted some entries
        assert!(cache.len() <= 10);
    }
}
