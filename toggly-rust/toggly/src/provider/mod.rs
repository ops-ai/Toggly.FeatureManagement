//! Feature definitions provider.

use crate::config::TogglyConfig;
use crate::definitions::FeatureDefinition;
use dashmap::DashMap;
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;
use tracing::{debug, info, warn};

/// Provider for fetching and caching feature definitions.
pub struct DefinitionsProvider {
    config: TogglyConfig,
    http_client: reqwest::Client,
    definitions: Arc<DashMap<String, FeatureDefinition>>,
    last_fetch: Arc<RwLock<Option<Instant>>>,
    etag: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<watch::Sender<bool>>,
}

impl DefinitionsProvider {
    /// Create a new definitions provider.
    pub fn new(config: TogglyConfig) -> crate::Result<Self> {
        let http_client = reqwest::Client::builder()
            .timeout(config.http_timeout)
            .build()?;

        Ok(Self {
            config,
            http_client,
            definitions: Arc::new(DashMap::new()),
            last_fetch: Arc::new(RwLock::new(None)),
            etag: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
        })
    }

    /// Initialize the provider by fetching definitions.
    pub async fn initialize(&mut self) -> crate::Result<()> {
        self.fetch_definitions().await?;

        // Start background refresh if enabled
        if !self.config.disable_background_refresh {
            self.start_background_refresh();
        }

        Ok(())
    }

    /// Start background refresh task.
    fn start_background_refresh(&mut self) {
        let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
        self.shutdown_tx = Some(shutdown_tx);

        let definitions = Arc::clone(&self.definitions);
        let last_fetch = Arc::clone(&self.last_fetch);
        let etag = Arc::clone(&self.etag);
        let config = self.config.clone();
        let http_client = self.http_client.clone();
        let refresh_interval = config.refresh_interval;

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(refresh_interval);

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(e) = Self::fetch_definitions_impl(
                            &http_client,
                            &config,
                            &definitions,
                            &last_fetch,
                            &etag,
                        ).await {
                            warn!(error = %e, "Failed to refresh definitions");
                        }
                    }
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() {
                            info!("Shutting down background refresh");
                            break;
                        }
                    }
                }
            }
        });
    }

    /// Fetch definitions from the API.
    pub async fn fetch_definitions(&self) -> crate::Result<()> {
        Self::fetch_definitions_impl(
            &self.http_client,
            &self.config,
            &self.definitions,
            &self.last_fetch,
            &self.etag,
        )
        .await
    }

    /// Internal implementation of fetch_definitions.
    async fn fetch_definitions_impl(
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        definitions: &DashMap<String, FeatureDefinition>,
        last_fetch: &RwLock<Option<Instant>>,
        etag: &RwLock<Option<String>>,
    ) -> crate::Result<()> {
        let url = config.definitions_endpoint();
        debug!(url = %url, "Fetching definitions");

        let mut request = http_client.get(&url);

        // Add ETag header for conditional fetch
        if let Some(ref e) = *etag.read() {
            request = request.header("If-None-Match", e.clone());
        }

        let response = request.send().await?;

        // Not modified - definitions are still fresh
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            debug!("Definitions not modified (304)");
            *last_fetch.write() = Some(Instant::now());
            return Ok(());
        }

        if !response.status().is_success() {
            return Err(crate::Error::Provider(format!(
                "Failed to fetch definitions: {}",
                response.status()
            )));
        }

        // Store new ETag
        if let Some(new_etag) = response.headers().get("etag") {
            if let Ok(etag_str) = new_etag.to_str() {
                *etag.write() = Some(etag_str.to_string());
            }
        }

        let body: serde_json::Value = response.json().await?;

        // Parse definitions - API returns a map of feature_key -> definition
        if let Some(obj) = body.as_object() {
            definitions.clear();
            for (key, value) in obj {
                if let Ok(def) = serde_json::from_value::<FeatureDefinition>(value.clone()) {
                    definitions.insert(key.clone(), def);
                }
            }
            info!(count = definitions.len(), "Loaded feature definitions");
        }

        *last_fetch.write() = Some(Instant::now());
        Ok(())
    }

    /// Get a feature definition by key.
    pub fn get(&self, feature_key: &str) -> Option<FeatureDefinition> {
        self.definitions.get(feature_key).map(|r| r.clone())
    }

    /// Check if a feature is defined.
    pub fn contains(&self, feature_key: &str) -> bool {
        self.definitions.contains_key(feature_key)
    }

    /// Get all feature keys.
    pub fn keys(&self) -> Vec<String> {
        self.definitions.iter().map(|r| r.key().clone()).collect()
    }

    /// Get the number of definitions.
    pub fn len(&self) -> usize {
        self.definitions.len()
    }

    /// Check if there are no definitions.
    pub fn is_empty(&self) -> bool {
        self.definitions.is_empty()
    }

    /// Check if a feature is secure.
    pub fn is_secure(&self, feature_key: &str) -> bool {
        self.definitions
            .get(feature_key)
            .map(|d| d.secured_feature)
            .unwrap_or(false)
    }

    /// Get time since last fetch.
    pub fn time_since_last_fetch(&self) -> Option<Duration> {
        self.last_fetch.read().map(|t| t.elapsed())
    }

    /// Shutdown the provider.
    pub fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
    }
}

impl Drop for DefinitionsProvider {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl std::fmt::Debug for DefinitionsProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DefinitionsProvider")
            .field("definitions_count", &self.definitions.len())
            .field("last_fetch", &self.last_fetch.read())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_new() {
        let config = TogglyConfig::builder()
            .app_key("test")
            .environment("test")
            .build();

        let provider = DefinitionsProvider::new(config).unwrap();
        assert!(provider.is_empty());
    }
}
