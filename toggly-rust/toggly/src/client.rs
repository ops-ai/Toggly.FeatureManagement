//! Main Toggly client.

use crate::cache::Cache;
use crate::config::{TogglyConfig, TogglyConfigBuilder};
use crate::context::EvalContext;
use crate::eval::Engine;
use crate::provider::DefinitionsProvider;
use crate::Requirement;
use std::sync::Arc;
use tracing::{debug, info, instrument};

/// Main Toggly client for feature flag evaluation.
///
/// The client provides methods for checking feature flags and evaluating
/// feature gates. It handles caching, background refresh, and thread-safe
/// concurrent access.
///
/// # Example
///
/// ```rust,no_run
/// use toggly::{TogglyClient, EvalContext};
///
/// #[tokio::main]
/// async fn main() -> toggly::Result<()> {
///     let client = TogglyClient::builder()
///         .app_key("your-app-key")
///         .environment("production")
///         .build()
///         .await?;
///
///     let enabled = client.is_enabled("my-feature", EvalContext::default()).await?;
///     println!("Feature enabled: {}", enabled);
///
///     client.close().await;
///     Ok(())
/// }
/// ```
pub struct TogglyClient {
    config: TogglyConfig,
    provider: Arc<tokio::sync::RwLock<DefinitionsProvider>>,
    engine: Engine,
    cache: Cache<bool>,
}

impl TogglyClient {
    /// Create a new client builder.
    pub fn builder() -> TogglyClientBuilder {
        TogglyClientBuilder::default()
    }

    /// Create a new client with the given configuration.
    pub async fn new(config: TogglyConfig) -> crate::Result<Self> {
        config.validate()?;

        let mut provider = DefinitionsProvider::new(config.clone())?;
        provider.initialize().await?;

        let cache = Cache::new(config.cache_ttl, config.cache_max_entries);

        Ok(Self {
            config,
            provider: Arc::new(tokio::sync::RwLock::new(provider)),
            engine: Engine::with_defaults(),
            cache,
        })
    }

    /// Get the configuration.
    pub fn config(&self) -> &TogglyConfig {
        &self.config
    }

    /// Get the evaluation engine.
    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// Check if a feature is enabled.
    ///
    /// # Arguments
    ///
    /// * `feature_key` - The feature key to check
    /// * `context` - The evaluation context
    ///
    /// # Returns
    ///
    /// `true` if the feature is enabled, `false` otherwise.
    #[instrument(skip(self, context), fields(feature = %feature_key))]
    pub async fn is_enabled(&self, feature_key: &str, context: EvalContext) -> crate::Result<bool> {
        if feature_key.is_empty() {
            return Err(crate::Error::Config("feature_key is required".to_string()));
        }

        // Check cache first
        let cache_key = self.cache_key(feature_key, &context);
        if let Some(cached) = self.cache.get(&cache_key) {
            debug!(feature = %feature_key, cached = %cached, "Cache hit");
            return Ok(cached);
        }

        // Get definition
        let provider = self.provider.read().await;
        let definition = match provider.get(feature_key) {
            Some(def) => def,
            None => {
                // Feature not found
                if self.config.enable_undefined_in_dev {
                    debug!(feature = %feature_key, "Feature not found, returning true (dev mode)");
                    return Ok(true);
                }
                debug!(feature = %feature_key, "Feature not found, returning false");
                return Ok(false);
            }
        };
        drop(provider); // Release lock before evaluation

        // Evaluate feature
        let result = self.engine.evaluate(&definition, &context)?;

        // Cache result
        self.cache.insert(cache_key, result);

        debug!(feature = %feature_key, enabled = %result, "Feature evaluated");
        Ok(result)
    }

    /// Check if a feature is disabled.
    ///
    /// This is a convenience method that returns the inverse of `is_enabled`.
    pub async fn is_disabled(
        &self,
        feature_key: &str,
        context: EvalContext,
    ) -> crate::Result<bool> {
        Ok(!self.is_enabled(feature_key, context).await?)
    }

    /// Evaluate a feature gate (multiple features with AND/OR logic).
    ///
    /// # Arguments
    ///
    /// * `feature_keys` - List of feature keys to evaluate
    /// * `requirement` - Whether all or any features must be enabled
    /// * `context` - The evaluation context
    /// * `negate` - Whether to negate the result
    ///
    /// # Returns
    ///
    /// `true` if the gate passes, `false` otherwise.
    #[instrument(skip(self, context), fields(features = ?feature_keys))]
    pub async fn evaluate_gate(
        &self,
        feature_keys: &[&str],
        requirement: Requirement,
        context: EvalContext,
        negate: bool,
    ) -> crate::Result<bool> {
        if feature_keys.is_empty() {
            return Ok(false);
        }

        match requirement {
            Requirement::All => {
                for key in feature_keys {
                    let mut enabled = self.is_enabled(key, context.clone()).await?;
                    if negate {
                        enabled = !enabled;
                    }
                    if !enabled {
                        return Ok(false);
                    }
                }
                Ok(true)
            }
            Requirement::Any => {
                for key in feature_keys {
                    let mut enabled = self.is_enabled(key, context.clone()).await?;
                    if negate {
                        enabled = !enabled;
                    }
                    if enabled {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        }
    }

    /// Get all feature keys.
    pub async fn feature_keys(&self) -> Vec<String> {
        self.provider.read().await.keys()
    }

    /// Check if a feature is defined.
    pub async fn is_defined(&self, feature_key: &str) -> bool {
        self.provider.read().await.contains(feature_key)
    }

    /// Check if a feature is defined (non-blocking, synchronous).
    ///
    /// This method attempts to check if a feature is defined without blocking.
    /// If the lock cannot be acquired immediately, returns `false`.
    ///
    /// Use this for synchronous contexts like route guards where async is not available.
    pub fn is_defined_sync(&self, feature_key: &str) -> bool {
        match self.provider.try_read() {
            Ok(guard) => guard.contains(feature_key),
            Err(_) => {
                // Lock is held, can't check - return false as safe default
                debug!(feature = %feature_key, "Could not acquire lock for sync check");
                false
            }
        }
    }

    /// Force a refresh of feature definitions.
    pub async fn refresh(&self) -> crate::Result<()> {
        self.provider.read().await.fetch_definitions().await?;
        self.cache.clear();
        info!("Feature definitions refreshed");
        Ok(())
    }

    /// Clear the evaluation cache.
    pub fn clear_cache(&self) {
        self.cache.clear();
    }

    /// Close the client and release resources.
    pub async fn close(&self) {
        self.provider.write().await.shutdown();
        self.cache.clear();
        info!("Toggly client closed");
    }

    /// Generate a cache key for the given feature and context.
    fn cache_key(&self, feature_key: &str, context: &EvalContext) -> String {
        let identity = context.identity.as_deref().unwrap_or("");
        let groups = context.groups.join(",");
        format!("{}:{}:{}", feature_key, identity, groups)
    }
}

impl std::fmt::Debug for TogglyClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TogglyClient")
            .field("config", &self.config)
            .field("cache_size", &self.cache.len())
            .finish()
    }
}

/// Builder for [`TogglyClient`].
#[derive(Default)]
pub struct TogglyClientBuilder {
    config_builder: TogglyConfigBuilder,
}

impl TogglyClientBuilder {
    /// Set the application key.
    pub fn app_key(mut self, app_key: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.app_key(app_key);
        self
    }

    /// Set the environment.
    pub fn environment(mut self, environment: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.environment(environment);
        self
    }

    /// Set the base URL.
    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.base_url(base_url);
        self
    }

    /// Set the definitions URL.
    pub fn definitions_url(mut self, definitions_url: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.definitions_url(definitions_url);
        self
    }

    /// Set the application version.
    pub fn app_version(mut self, app_version: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.app_version(app_version);
        self
    }

    /// Set the instance name.
    pub fn instance_name(mut self, instance_name: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.instance_name(instance_name);
        self
    }

    /// Set the refresh interval.
    pub fn refresh_interval(mut self, interval: std::time::Duration) -> Self {
        self.config_builder = self.config_builder.refresh_interval(interval);
        self
    }

    /// Set the HTTP timeout.
    pub fn http_timeout(mut self, timeout: std::time::Duration) -> Self {
        self.config_builder = self.config_builder.http_timeout(timeout);
        self
    }

    /// Enable undefined features in development mode.
    pub fn enable_undefined_in_dev(mut self, enabled: bool) -> Self {
        self.config_builder = self.config_builder.enable_undefined_in_dev(enabled);
        self
    }

    /// Disable background refresh.
    pub fn disable_background_refresh(mut self, disabled: bool) -> Self {
        self.config_builder = self.config_builder.disable_background_refresh(disabled);
        self
    }

    /// Enable signed definitions endpoint usage.
    pub fn use_signed_definitions(mut self, enabled: bool) -> Self {
        self.config_builder = self.config_builder.use_signed_definitions(enabled);
        self
    }

    /// Enable live updates via WebSocket.
    pub fn enable_live_updates(mut self, enabled: bool) -> Self {
        self.config_builder = self.config_builder.enable_live_updates(enabled);
        self
    }

    /// Set the cache TTL.
    pub fn cache_ttl(mut self, ttl: std::time::Duration) -> Self {
        self.config_builder = self.config_builder.cache_ttl(ttl);
        self
    }

    /// Set the maximum number of cache entries.
    pub fn cache_max_entries(mut self, max_entries: usize) -> Self {
        self.config_builder = self.config_builder.cache_max_entries(max_entries);
        self
    }

    /// Build the client.
    pub async fn build(self) -> crate::Result<TogglyClient> {
        TogglyClient::new(self.config_builder.build()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder() {
        let _builder = TogglyClient::builder()
            .app_key("test")
            .environment("staging");
    }

    #[tokio::test]
    async fn test_empty_feature_key() {
        // This would fail validation if we could build without a server
        // For now, just verify the error type
        let _config = TogglyConfig::builder()
            .app_key("test")
            .environment("test")
            .disable_background_refresh(true)
            .build();

        // Would need mock server to test fully
    }
}
