//! Feature definitions provider.

use crate::config::TogglyConfig;
use crate::definitions::{FeatureDefinition, SignedDefinitionsResponse};
use crate::sdk_identity::{append_sdk_query, sdk_user_agent};
use dashmap::DashMap;
use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::watch;
use tracing::{debug, error, info, warn};

/// Fallback refresh interval when WebSocket is connected (20 minutes).
const WS_FALLBACK_REFRESH_SECS: u64 = 20 * 60;

/// Delay before attempting WebSocket reconnection (5 seconds).
const WS_RECONNECT_DELAY_SECS: u64 = 5;

/// Provider for fetching and caching feature definitions.
pub struct DefinitionsProvider {
    config: TogglyConfig,
    http_client: reqwest::Client,
    definitions: Arc<DashMap<String, FeatureDefinition>>,
    last_fetch: Arc<RwLock<Option<Instant>>>,
    etag: Arc<RwLock<Option<String>>>,
    shutdown_tx: Option<watch::Sender<bool>>,
    ws_connected: Arc<AtomicBool>,
    last_fallback_refresh: Arc<RwLock<Instant>>,
}

impl DefinitionsProvider {
    /// Create a new definitions provider.
    pub fn new(config: TogglyConfig) -> crate::Result<Self> {
        let http_client = reqwest::Client::builder()
            .timeout(config.http_timeout)
            .user_agent(sdk_user_agent())
            .build()?;

        Ok(Self {
            config,
            http_client,
            definitions: Arc::new(DashMap::new()),
            last_fetch: Arc::new(RwLock::new(None)),
            etag: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
            ws_connected: Arc::new(AtomicBool::new(false)),
            last_fallback_refresh: Arc::new(RwLock::new(Instant::now())),
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

    /// Build the WebSocket URL from the definitions URL.
    fn build_ws_url(config: &TogglyConfig, cached_revision: Option<&str>) -> String {
        let base = if config.definitions_url.ends_with('/') {
            &config.definitions_url[..config.definitions_url.len() - 1]
        } else {
            &config.definitions_url
        };
        let ws_base = base
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        append_sdk_query(
            &format!("{}/{}/ws", ws_base, config.app_key),
            cached_revision,
        )
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
        let ws_connected = Arc::clone(&self.ws_connected);
        let last_fallback_refresh = Arc::clone(&self.last_fallback_refresh);

        // Spawn WebSocket live updates task if enabled
        if config.enable_live_updates {
            let ws_definitions = Arc::clone(&definitions);
            let ws_last_fetch = Arc::clone(&last_fetch);
            let ws_etag = Arc::clone(&etag);
            let ws_config = config.clone();
            let ws_http_client = http_client.clone();
            let ws_connected_flag = Arc::clone(&ws_connected);
            let ws_last_fallback = Arc::clone(&last_fallback_refresh);
            let mut ws_shutdown_rx = shutdown_rx.clone();

            tokio::spawn(async move {
                let ws_url = Self::build_ws_url(&ws_config, ws_etag.read().as_deref());
                info!(url = %ws_url, "Starting WebSocket live updates");

                loop {
                    // Check for shutdown before attempting connection
                    if *ws_shutdown_rx.borrow() {
                        debug!("WebSocket task shutting down");
                        break;
                    }

                    let ws_url = Self::build_ws_url(&ws_config, ws_etag.read().as_deref());
                    debug!(url = %ws_url, "Connecting WebSocket");
                    match tokio_tungstenite::connect_async(&ws_url).await {
                        Ok((ws_stream, _response)) => {
                            ws_connected_flag.store(true, Ordering::SeqCst);
                            *ws_last_fallback.write() = Instant::now();
                            info!("WebSocket connected");

                            use futures_util::StreamExt;
                            let (_, mut read) = ws_stream.split();

                            loop {
                                tokio::select! {
                                    msg = read.next() => {
                                        match msg {
                                            Some(Ok(message)) => {
                                                if let tokio_tungstenite::tungstenite::Message::Text(text) = message {
                                                    Self::handle_ws_message(
                                                        &text,
                                                        &ws_http_client,
                                                        &ws_config,
                                                        &ws_definitions,
                                                        &ws_last_fetch,
                                                        &ws_etag,
                                                    ).await;
                                                }
                                            }
                                            Some(Err(e)) => {
                                                error!(error = %e, "WebSocket error");
                                                break;
                                            }
                                            None => {
                                                debug!("WebSocket stream ended");
                                                break;
                                            }
                                        }
                                    }
                                    _ = ws_shutdown_rx.changed() => {
                                        if *ws_shutdown_rx.borrow() {
                                            debug!("WebSocket task shutting down");
                                            ws_connected_flag.store(false, Ordering::SeqCst);
                                            return;
                                        }
                                    }
                                }
                            }

                            ws_connected_flag.store(false, Ordering::SeqCst);
                        }
                        Err(e) => {
                            error!(error = %e, "WebSocket connection failed");
                        }
                    }

                    // Reconnect after delay, unless shutting down
                    debug!(
                        "WebSocket disconnected, reconnecting in {}s",
                        WS_RECONNECT_DELAY_SECS
                    );
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(WS_RECONNECT_DELAY_SECS)) => {}
                        _ = ws_shutdown_rx.changed() => {
                            if *ws_shutdown_rx.borrow() {
                                debug!("WebSocket task shutting down during reconnect delay");
                                break;
                            }
                        }
                    }
                }
            });
        }

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(refresh_interval);

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        // When WebSocket is connected, throttle HTTP polls to fallback interval
                        if ws_connected.load(Ordering::SeqCst) {
                            let elapsed = last_fallback_refresh.read().elapsed();
                            if elapsed < Duration::from_secs(WS_FALLBACK_REFRESH_SECS) {
                                debug!("WebSocket connected, skipping poll (fallback in {}s)",
                                    WS_FALLBACK_REFRESH_SECS - elapsed.as_secs());
                                continue;
                            }
                            *last_fallback_refresh.write() = Instant::now();
                            debug!("WebSocket connected, performing fallback refresh");
                        }

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

    /// Handle an incoming WebSocket text message.
    async fn handle_ws_message(
        text: &str,
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        definitions: &DashMap<String, FeatureDefinition>,
        last_fetch: &RwLock<Option<Instant>>,
        etag: &RwLock<Option<String>>,
    ) {
        // Try parsing as JSON first
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                if msg_type == "ping" {
                    return;
                }
                if msg_type == "flags-updated" || msg_type == "update" {
                    debug!("WebSocket: definitions updated, refreshing");
                    if let Err(e) = Self::fetch_definitions_impl(
                        http_client,
                        config,
                        definitions,
                        last_fetch,
                        etag,
                    )
                    .await
                    {
                        error!(error = %e, "WebSocket-triggered refresh failed");
                    }
                }
                return;
            }
        }

        // Non-JSON message — check for plain text signals
        let trimmed = text.trim();
        if trimmed == "update" || trimmed == "flags-updated" {
            debug!("WebSocket: plain text update signal, refreshing");
            if let Err(e) =
                Self::fetch_definitions_impl(http_client, config, definitions, last_fetch, etag)
                    .await
            {
                error!(error = %e, "WebSocket-triggered refresh failed");
            }
        }
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
        let parsed_definitions = if config.use_signed_definitions {
            let signed: SignedDefinitionsResponse = serde_json::from_value(body).map_err(|e| {
                crate::Error::Provider(format!("Invalid signed definitions payload: {e}"))
            })?;
            Self::parse_definitions_payload(signed.defs)?
        } else {
            Self::parse_definitions_payload(body)?
        };

        definitions.clear();
        for definition in parsed_definitions {
            definitions.insert(definition.feature_key.clone(), definition);
        }
        info!(count = definitions.len(), "Loaded feature definitions");

        *last_fetch.write() = Some(Instant::now());
        Ok(())
    }

    fn parse_definitions_payload(
        payload: serde_json::Value,
    ) -> crate::Result<Vec<FeatureDefinition>> {
        if let Some(array) = payload.as_array() {
            let mut definitions = Vec::with_capacity(array.len());
            for item in array {
                if item.is_null() {
                    continue;
                }
                let definition = serde_json::from_value::<FeatureDefinition>(item.clone())
                    .map_err(|e| {
                        crate::Error::Provider(format!(
                            "Invalid feature definition in array payload: {e}"
                        ))
                    })?;
                definitions.push(definition);
            }
            return Ok(definitions);
        }

        if let Some(obj) = payload.as_object() {
            // Support a single definition object payload.
            if obj.contains_key("featureKey") {
                let definition = serde_json::from_value::<FeatureDefinition>(
                    serde_json::Value::Object(obj.clone()),
                )
                .map_err(|e| {
                    crate::Error::Provider(format!(
                        "Invalid single feature definition payload: {e}"
                    ))
                })?;
                return Ok(vec![definition]);
            }

            // Support map payloads keyed by feature key.
            let mut definitions = Vec::with_capacity(obj.len());
            for value in obj.values() {
                let definition = serde_json::from_value::<FeatureDefinition>(value.clone())
                    .map_err(|e| {
                        crate::Error::Provider(format!(
                            "Invalid feature definition in map payload: {e}"
                        ))
                    })?;
                definitions.push(definition);
            }
            return Ok(definitions);
        }

        Err(crate::Error::Provider(
            "Unsupported definitions payload format".to_string(),
        ))
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

    /// Check if the WebSocket connection is active.
    pub fn is_ws_connected(&self) -> bool {
        self.ws_connected.load(Ordering::SeqCst)
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
            .field("ws_connected", &self.ws_connected.load(Ordering::SeqCst))
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
        assert!(!provider.is_ws_connected());
    }

    #[test]
    fn test_build_ws_url() {
        let config = TogglyConfig::builder()
            .app_key("my-app")
            .environment("production")
            .build();

        let url = DefinitionsProvider::build_ws_url(&config, None);
        assert_eq!(
            url,
            "wss://definitions.toggly.io/my-app/ws?sdk=rust&sdkVersion=0.1.0"
        );
    }

    #[test]
    fn test_build_ws_url_with_trailing_slash() {
        let config = TogglyConfig::builder()
            .app_key("my-app")
            .environment("production")
            .definitions_url("https://custom.example.com/")
            .build();

        let url = DefinitionsProvider::build_ws_url(&config, Some("rev123"));
        assert_eq!(
            url,
            "wss://custom.example.com/my-app/ws?rev=rev123&sdk=rust&sdkVersion=0.1.0"
        );
    }

    #[test]
    fn test_build_ws_url_http() {
        let config = TogglyConfig::builder()
            .app_key("my-app")
            .environment("production")
            .definitions_url("http://localhost:8080")
            .build();

        let url = DefinitionsProvider::build_ws_url(&config, None);
        assert_eq!(
            url,
            "ws://localhost:8080/my-app/ws?sdk=rust&sdkVersion=0.1.0"
        );
    }
}
