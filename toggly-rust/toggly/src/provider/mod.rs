//! Feature definitions provider.

use crate::config::TogglyConfig;
use crate::crypto::verify_signed_definitions;
use crate::definitions::{FeatureDefinition, JwkSet, SignedDefinitionsResponse};
use crate::sdk_identity::{append_sdk_query, sdk_user_agent};
use chrono::{DateTime, Utc};
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

/// JWKS cache TTL (1 hour).
const JWKS_TTL_SECS: u64 = 60 * 60;

const DEFINITIONS_REVISION_HEADER: &str = "x-definitions-revision";

struct JwksCache {
    set: JwkSet,
    expiry: Instant,
}

/// Provider for fetching and caching feature definitions.
pub struct DefinitionsProvider {
    config: TogglyConfig,
    http_client: reqwest::Client,
    definitions: Arc<DashMap<String, FeatureDefinition>>,
    last_fetch: Arc<RwLock<Option<Instant>>>,
    etag: Arc<RwLock<Option<String>>>,
    last_timestamp: Arc<RwLock<Option<i64>>>,
    last_error: Arc<RwLock<Option<String>>>,
    last_error_time: Arc<RwLock<Option<DateTime<Utc>>>>,
    jwks: Arc<RwLock<Option<JwksCache>>>,
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
            last_timestamp: Arc::new(RwLock::new(None)),
            last_error: Arc::new(RwLock::new(None)),
            last_error_time: Arc::new(RwLock::new(None)),
            jwks: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
            ws_connected: Arc::new(AtomicBool::new(false)),
            last_fallback_refresh: Arc::new(RwLock::new(Instant::now())),
        })
    }

    /// Initialize the provider by fetching definitions.
    pub async fn initialize(&mut self) -> crate::Result<()> {
        self.fetch_definitions().await?;

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
        let last_timestamp = Arc::clone(&self.last_timestamp);
        let last_error = Arc::clone(&self.last_error);
        let last_error_time = Arc::clone(&self.last_error_time);
        let jwks = Arc::clone(&self.jwks);
        let config = self.config.clone();
        let http_client = self.http_client.clone();
        let refresh_interval = config.refresh_interval;
        let ws_connected = Arc::clone(&self.ws_connected);
        let last_fallback_refresh = Arc::clone(&self.last_fallback_refresh);

        if config.enable_live_updates {
            let ws_definitions = Arc::clone(&definitions);
            let ws_last_fetch = Arc::clone(&last_fetch);
            let ws_etag = Arc::clone(&etag);
            let ws_last_timestamp = Arc::clone(&last_timestamp);
            let ws_last_error = Arc::clone(&last_error);
            let ws_last_error_time = Arc::clone(&last_error_time);
            let ws_jwks = Arc::clone(&jwks);
            let ws_config = config.clone();
            let ws_http_client = http_client.clone();
            let ws_connected_flag = Arc::clone(&ws_connected);
            let ws_last_fallback = Arc::clone(&last_fallback_refresh);
            let mut ws_shutdown_rx = shutdown_rx.clone();

            tokio::spawn(async move {
                info!("Starting WebSocket live updates");

                loop {
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
                                                        &ws_last_timestamp,
                                                        &ws_last_error,
                                                        &ws_last_error_time,
                                                        &ws_jwks,
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
                            &last_timestamp,
                            &last_error,
                            &last_error_time,
                            &jwks,
                            false,
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
        last_timestamp: &RwLock<Option<i64>>,
        last_error: &RwLock<Option<String>>,
        last_error_time: &RwLock<Option<DateTime<Utc>>>,
        jwks: &RwLock<Option<JwksCache>>,
    ) {
        if let Ok(msg) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                if msg_type == "ping" {
                    return;
                }

                let force_jwks = msg_type == "signing-key-updated";
                let should_refresh = match msg_type {
                    "signing-key-updated" => true,
                    "sync" => {
                        if msg.get("unchanged").and_then(|v| v.as_bool()) == Some(true) {
                            false
                        } else {
                            let cached = etag.read().clone();
                            match (msg.get("etag").and_then(|v| v.as_str()), cached.as_deref()) {
                                (_, None) => true,
                                (Some(incoming), Some(cached)) => incoming != cached,
                                _ => false,
                            }
                        }
                    }
                    "flags-updated" | "update" => {
                        let cached = etag.read().clone();
                        match (msg.get("etag").and_then(|v| v.as_str()), cached.as_deref()) {
                            (_, None) | (None, _) => true,
                            (Some(incoming), Some(cached)) => incoming != cached,
                        }
                    }
                    _ => false,
                };

                if let Some(incoming) = msg.get("etag").and_then(|v| v.as_str()) {
                    if !force_jwks {
                        *etag.write() = Some(incoming.to_string());
                    }
                }

                if should_refresh {
                    debug!(msg_type, force_jwks, "WebSocket: refreshing definitions");
                    if let Err(e) = Self::fetch_definitions_impl(
                        http_client,
                        config,
                        definitions,
                        last_fetch,
                        etag,
                        last_timestamp,
                        last_error,
                        last_error_time,
                        jwks,
                        force_jwks,
                    )
                    .await
                    {
                        error!(error = %e, "WebSocket-triggered refresh failed");
                    }
                }
                return;
            }
        }

        let trimmed = text.trim();
        if trimmed == "update" || trimmed == "flags-updated" {
            debug!("WebSocket: plain text update signal, refreshing");
            if let Err(e) = Self::fetch_definitions_impl(
                http_client,
                config,
                definitions,
                last_fetch,
                etag,
                last_timestamp,
                last_error,
                last_error_time,
                jwks,
                false,
            )
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
            &self.last_timestamp,
            &self.last_error,
            &self.last_error_time,
            &self.jwks,
            false,
        )
        .await
    }

    /// Clear in-memory definitions, ETag/revision, and cached JWKS.
    pub fn clear(&self) {
        self.definitions.clear();
        *self.etag.write() = None;
        *self.last_timestamp.write() = None;
        *self.jwks.write() = None;
        debug!("Cleared in-memory definitions and JWKS cache");
    }

    /// Last refresh error message, if any.
    pub fn last_error(&self) -> Option<String> {
        self.last_error.read().clone()
    }

    /// Last refresh error timestamp (UTC), if any.
    pub fn last_error_time(&self) -> Option<DateTime<Utc>> {
        *self.last_error_time.read()
    }

    /// Cached definitions revision / ETag.
    pub fn etag(&self) -> Option<String> {
        self.etag.read().clone()
    }

    fn record_error(
        config: &TogglyConfig,
        last_error: &RwLock<Option<String>>,
        last_error_time: &RwLock<Option<DateTime<Utc>>>,
        err: &crate::Error,
    ) {
        *last_error.write() = Some(err.to_string());
        *last_error_time.write() = Some(Utc::now());
        config.report_error(err);
    }

    fn clear_jwks(jwks: &RwLock<Option<JwksCache>>, etag: &RwLock<Option<String>>) {
        *jwks.write() = None;
        *etag.write() = None;
    }

    /// Internal implementation of fetch_definitions.
    async fn fetch_definitions_impl(
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        definitions: &DashMap<String, FeatureDefinition>,
        last_fetch: &RwLock<Option<Instant>>,
        etag: &RwLock<Option<String>>,
        last_timestamp: &RwLock<Option<i64>>,
        last_error: &RwLock<Option<String>>,
        last_error_time: &RwLock<Option<DateTime<Utc>>>,
        jwks: &RwLock<Option<JwksCache>>,
        force_jwks_refresh: bool,
    ) -> crate::Result<()> {
        if force_jwks_refresh {
            Self::clear_jwks(jwks, etag);
        }

        let url = config.definitions_endpoint();
        debug!(url = %url, "Fetching definitions");

        let mut request = http_client.get(&url);

        if let Some(ref e) = *etag.read() {
            request = request.header("If-None-Match", e.clone());
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                let err = crate::Error::from(e);
                Self::record_error(config, last_error, last_error_time, &err);
                return Err(err);
            }
        };

        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            debug!("Definitions not modified (304)");
            *last_fetch.write() = Some(Instant::now());
            return Ok(());
        }

        if !response.status().is_success() {
            let err = crate::Error::Provider(format!(
                "Failed to fetch definitions: {}",
                response.status()
            ));
            Self::record_error(config, last_error, last_error_time, &err);
            return Err(err);
        }

        let revision = response
            .headers()
            .get(DEFINITIONS_REVISION_HEADER)
            .or_else(|| response.headers().get("etag"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim_matches('"').to_string());

        let body_bytes = match response.bytes().await {
            Ok(b) => b,
            Err(e) => {
                let err = crate::Error::from(e);
                Self::record_error(config, last_error, last_error_time, &err);
                return Err(err);
            }
        };

        let parsed_definitions = if config.use_signed_definitions {
            let current_ts = *last_timestamp.read();
            match Self::parse_and_verify_signed(http_client, config, &body_bytes, jwks).await {
                Ok((defs, ts)) => {
                    if let Some(prev) = current_ts {
                        if ts < prev {
                            debug!(
                                prev,
                                ts, "Ignoring signed definitions with older timestamp"
                            );
                            *last_fetch.write() = Some(Instant::now());
                            return Ok(());
                        }
                    }
                    *last_timestamp.write() = Some(ts);
                    defs
                }
                Err(e) => {
                    // Preserve last-known-good definitions on verify/fetch failure.
                    Self::record_error(config, last_error, last_error_time, &e);
                    return Err(e);
                }
            }
        } else {
            let body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
                Ok(v) => v,
                Err(e) => {
                    let err = crate::Error::from(e);
                    Self::record_error(config, last_error, last_error_time, &err);
                    return Err(err);
                }
            };
            match Self::parse_definitions_payload(body) {
                Ok(defs) => defs,
                Err(e) => {
                    Self::record_error(config, last_error, last_error_time, &e);
                    return Err(e);
                }
            }
        };

        if let Some(rev) = revision {
            *etag.write() = Some(rev);
        }

        definitions.clear();
        for definition in parsed_definitions {
            definitions.insert(definition.feature_key.clone(), definition);
        }
        info!(count = definitions.len(), "Loaded feature definitions");

        *last_fetch.write() = Some(Instant::now());
        *last_error.write() = None;
        *last_error_time.write() = None;
        Ok(())
    }

    async fn parse_and_verify_signed(
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        body_bytes: &[u8],
        jwks_cache: &RwLock<Option<JwksCache>>,
    ) -> crate::Result<(Vec<FeatureDefinition>, i64)> {
        let signed: SignedDefinitionsResponse =
            serde_json::from_slice(body_bytes).map_err(|e| {
                crate::Error::Provider(format!("Invalid signed definitions payload: {e}"))
            })?;

        let jwks = Self::load_or_fetch_jwks(http_client, config, jwks_cache).await?;
        verify_signed_definitions(&signed, &jwks, config.allowed_key_ids.as_ref())
            .map_err(|e| crate::Error::Signature(e.to_string()))?;

        let defs_value: serde_json::Value = serde_json::from_str(signed.defs.get())
            .map_err(|e| crate::Error::Provider(format!("Invalid defs payload: {e}")))?;
        let defs = Self::parse_definitions_payload(defs_value)?;
        Ok((defs, signed.timestamp))
    }

    async fn load_or_fetch_jwks(
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        jwks_cache: &RwLock<Option<JwksCache>>,
    ) -> crate::Result<JwkSet> {
        {
            let guard = jwks_cache.read();
            if let Some(cached) = guard.as_ref() {
                if Instant::now() < cached.expiry {
                    return Ok(cached.set.clone());
                }
            }
        }

        let url = config.jwks_endpoint();
        debug!(url = %url, "Fetching JWKS");
        let response = http_client.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(crate::Error::Provider(format!(
                "JWKS fetch failed: {}",
                response.status()
            )));
        }
        let set: JwkSet = response.json().await?;
        *jwks_cache.write() = Some(JwksCache {
            set: set.clone(),
            expiry: Instant::now() + Duration::from_secs(JWKS_TTL_SECS),
        });
        Ok(set)
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
            .field("etag", &self.etag.read())
            .field("last_error", &self.last_error.read())
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
    fn test_clear_resets_defs_and_etag() {
        let config = TogglyConfig::builder()
            .app_key("test")
            .environment("test")
            .build();
        let provider = DefinitionsProvider::new(config).unwrap();
        provider.definitions.insert(
            "f1".into(),
            FeatureDefinition {
                feature_key: "f1".into(),
                filters: vec![],
                metrics: vec![],
                secured_feature: false,
                client_sdk_enabled: true,
                requirement_type: Default::default(),
            },
        );
        *provider.etag.write() = Some("rev1".into());
        *provider.jwks.write() = Some(JwksCache {
            set: JwkSet { keys: vec![] },
            expiry: Instant::now() + Duration::from_secs(60),
        });

        provider.clear();

        assert!(provider.is_empty());
        assert!(provider.etag().is_none());
        assert!(provider.jwks.read().is_none());
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
            "wss://definitions.toggly.io/my-app/ws?sdk=rust&sdkVersion=0.2.0"
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
            "wss://custom.example.com/my-app/ws?rev=rev123&sdk=rust&sdkVersion=0.2.0"
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
            "ws://localhost:8080/my-app/ws?sdk=rust&sdkVersion=0.2.0"
        );
    }
}
