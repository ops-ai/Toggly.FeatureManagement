//! Configuration for the Toggly client.

use crate::Error;
use std::collections::HashSet;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

/// Callback invoked when a refresh or verification error occurs.
pub type OnErrorCallback = Arc<dyn Fn(&Error) + Send + Sync>;

/// Configuration for the Toggly client.
#[derive(Clone)]
pub struct TogglyConfig {
    /// Application key from Toggly dashboard.
    pub app_key: String,

    /// Environment name (e.g., "production", "staging").
    pub environment: String,

    /// Base URL for the Toggly API.
    pub base_url: String,

    /// Definitions URL for fetching feature definitions.
    pub definitions_url: String,

    /// Application version for analytics.
    pub app_version: Option<String>,

    /// Instance name for identification.
    pub instance_name: Option<String>,

    /// Interval for refreshing feature definitions.
    pub refresh_interval: Duration,

    /// HTTP timeout for API requests.
    pub http_timeout: Duration,

    /// Enable undefined features in development mode.
    pub enable_undefined_in_dev: bool,

    /// Disable background refresh of definitions.
    pub disable_background_refresh: bool,

    /// Whether to fetch signed definitions from `definitions-signed`.
    pub use_signed_definitions: bool,

    /// Enable live updates via WebSocket.
    pub enable_live_updates: bool,

    /// Cache TTL for feature evaluations.
    pub cache_ttl: Duration,

    /// Maximum number of cached entries.
    pub cache_max_entries: usize,

    /// Optional allow-list of signing key IDs. Empty / None allows all keys.
    pub allowed_key_ids: Option<HashSet<String>>,

    /// Optional error callback for refresh / signature failures.
    pub on_error: Option<OnErrorCallback>,

    /// Skip startup PUT to sdk/{appKey}/contexts. Default false (registration on).
    pub disable_entity_context_registration: bool,
}

impl Default for TogglyConfig {
    fn default() -> Self {
        Self {
            app_key: String::new(),
            environment: "Production".to_string(),
            base_url: "https://definitions.toggly.io/".to_string(),
            definitions_url: "https://definitions.toggly.io/".to_string(),
            app_version: None,
            instance_name: None,
            refresh_interval: Duration::from_secs(300), // 5 minutes
            http_timeout: Duration::from_secs(10),
            enable_undefined_in_dev: false,
            disable_background_refresh: false,
            use_signed_definitions: false,
            enable_live_updates: false,
            cache_ttl: Duration::from_secs(60),
            cache_max_entries: 10_000,
            allowed_key_ids: None,
            on_error: None,
            disable_entity_context_registration: false,
        }
    }
}

impl fmt::Debug for TogglyConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TogglyConfig")
            .field("app_key", &self.app_key)
            .field("environment", &self.environment)
            .field("base_url", &self.base_url)
            .field("definitions_url", &self.definitions_url)
            .field("app_version", &self.app_version)
            .field("instance_name", &self.instance_name)
            .field("refresh_interval", &self.refresh_interval)
            .field("http_timeout", &self.http_timeout)
            .field("enable_undefined_in_dev", &self.enable_undefined_in_dev)
            .field(
                "disable_background_refresh",
                &self.disable_background_refresh,
            )
            .field("use_signed_definitions", &self.use_signed_definitions)
            .field("enable_live_updates", &self.enable_live_updates)
            .field("cache_ttl", &self.cache_ttl)
            .field("cache_max_entries", &self.cache_max_entries)
            .field("allowed_key_ids", &self.allowed_key_ids)
            .field("on_error", &self.on_error.as_ref().map(|_| "<callback>"))
            .finish()
    }
}

impl TogglyConfig {
    /// Create a new configuration builder.
    pub fn builder() -> TogglyConfigBuilder {
        TogglyConfigBuilder::default()
    }

    /// Validate the configuration.
    pub fn validate(&self) -> crate::Result<()> {
        if self.app_key.is_empty() {
            return Err(crate::Error::Config("app_key is required".to_string()));
        }
        if self.environment.is_empty() {
            return Err(crate::Error::Config("environment is required".to_string()));
        }
        Ok(())
    }

    /// Get the full definitions URL.
    pub fn definitions_endpoint(&self) -> String {
        let base = if self.definitions_url.ends_with('/') {
            &self.definitions_url[..self.definitions_url.len() - 1]
        } else {
            &self.definitions_url
        };
        if self.use_signed_definitions {
            format!(
                "{}/definitions-signed/{}/{}",
                base, self.app_key, self.environment
            )
        } else {
            format!("{}/definitions/{}/{}", base, self.app_key, self.environment)
        }
    }

    /// JWKS endpoint for signed definitions verification.
    pub fn jwks_endpoint(&self) -> String {
        let base = if self.definitions_url.ends_with('/') {
            self.definitions_url.clone()
        } else {
            format!("{}/", self.definitions_url)
        };
        format!("{}.well-known/jwks", base)
    }

    pub(crate) fn report_error(&self, err: &Error) {
        if let Some(cb) = &self.on_error {
            cb(err);
        }
    }
}

/// Builder for [`TogglyConfig`].
#[derive(Default)]
pub struct TogglyConfigBuilder {
    config: TogglyConfig,
}

impl TogglyConfigBuilder {
    /// Set the application key.
    pub fn app_key(mut self, app_key: impl Into<String>) -> Self {
        self.config.app_key = app_key.into();
        self
    }

    /// Set the environment.
    pub fn environment(mut self, environment: impl Into<String>) -> Self {
        self.config.environment = environment.into();
        self
    }

    /// Set the base URL.
    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.config.base_url = base_url.into();
        self
    }

    /// Set the definitions URL.
    pub fn definitions_url(mut self, definitions_url: impl Into<String>) -> Self {
        self.config.definitions_url = definitions_url.into();
        self
    }

    /// Set the application version.
    pub fn app_version(mut self, app_version: impl Into<String>) -> Self {
        self.config.app_version = Some(app_version.into());
        self
    }

    /// Set the instance name.
    pub fn instance_name(mut self, instance_name: impl Into<String>) -> Self {
        self.config.instance_name = Some(instance_name.into());
        self
    }

    /// Set the refresh interval.
    pub fn refresh_interval(mut self, interval: Duration) -> Self {
        self.config.refresh_interval = interval;
        self
    }

    /// Set the HTTP timeout.
    pub fn http_timeout(mut self, timeout: Duration) -> Self {
        self.config.http_timeout = timeout;
        self
    }

    /// Enable undefined features in development mode.
    pub fn enable_undefined_in_dev(mut self, enabled: bool) -> Self {
        self.config.enable_undefined_in_dev = enabled;
        self
    }

    /// Disable background refresh.
    pub fn disable_background_refresh(mut self, disabled: bool) -> Self {
        self.config.disable_background_refresh = disabled;
        self
    }

    /// Enable signed definitions endpoint usage.
    pub fn use_signed_definitions(mut self, enabled: bool) -> Self {
        self.config.use_signed_definitions = enabled;
        self
    }

    /// Enable live updates via WebSocket.
    pub fn enable_live_updates(mut self, enabled: bool) -> Self {
        self.config.enable_live_updates = enabled;
        self
    }

    /// Set the cache TTL.
    pub fn cache_ttl(mut self, ttl: Duration) -> Self {
        self.config.cache_ttl = ttl;
        self
    }

    /// Set the maximum number of cache entries.
    pub fn cache_max_entries(mut self, max_entries: usize) -> Self {
        self.config.cache_max_entries = max_entries;
        self
    }

    /// Restrict accepted signing key IDs.
    pub fn allowed_key_ids(mut self, kids: HashSet<String>) -> Self {
        self.config.allowed_key_ids = Some(kids);
        self
    }

    /// Set an error callback invoked on refresh / verification failures.
    pub fn on_error(mut self, callback: OnErrorCallback) -> Self {
        self.config.on_error = Some(callback);
        self
    }

    /// Skip startup PUT of entity context schemas.
    pub fn disable_entity_context_registration(mut self, disabled: bool) -> Self {
        self.config.disable_entity_context_registration = disabled;
        self
    }

    /// Build the configuration.
    pub fn build(self) -> TogglyConfig {
        self.config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = TogglyConfig::default();
        assert_eq!(config.environment, "Production");
        assert_eq!(config.base_url, "https://definitions.toggly.io/");
        assert_eq!(config.refresh_interval, Duration::from_secs(300));
    }

    #[test]
    fn test_builder() {
        let config = TogglyConfig::builder()
            .app_key("test-key")
            .environment("staging")
            .refresh_interval(Duration::from_secs(60))
            .build();

        assert_eq!(config.app_key, "test-key");
        assert_eq!(config.environment, "staging");
        assert_eq!(config.refresh_interval, Duration::from_secs(60));
    }

    #[test]
    fn test_validate() {
        let config = TogglyConfig::default();
        assert!(config.validate().is_err());

        let config = TogglyConfig::builder().app_key("test").build();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_definitions_endpoint() {
        let config = TogglyConfig::builder()
            .app_key("my-app")
            .environment("production")
            .build();

        assert_eq!(
            config.definitions_endpoint(),
            "https://definitions.toggly.io/definitions/my-app/production"
        );
    }

    #[test]
    fn test_signed_definitions_endpoint() {
        let config = TogglyConfig::builder()
            .app_key("my-app")
            .environment("production")
            .use_signed_definitions(true)
            .build();

        assert_eq!(
            config.definitions_endpoint(),
            "https://definitions.toggly.io/definitions-signed/my-app/production"
        );
        assert_eq!(
            config.jwks_endpoint(),
            "https://definitions.toggly.io/.well-known/jwks"
        );
    }
}
