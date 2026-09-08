//! Feature definitions provider.

use crate::config::TogglyConfig;
use crate::crypto::verify_signed_definitions;
use crate::definition_cache::{
    cached_signed_timestamp, classify_http, DefinitionCacheRecorder, HttpCacheKind,
    RefreshCacheOutcome,
};
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
    last_modified: Arc<RwLock<Option<String>>>,
    last_timestamp: Arc<RwLock<Option<i64>>>,
    last_error: Arc<RwLock<Option<String>>>,
    last_error_time: Arc<RwLock<Option<DateTime<Utc>>>>,
    jwks: Arc<RwLock<Option<JwksCache>>>,
    shutdown_tx: Option<watch::Sender<bool>>,
    ws_connected: Arc<AtomicBool>,
    last_fallback_refresh: Arc<RwLock<Instant>>,
    refresh_in_flight: Arc<AtomicBool>,
    pending_ws_refresh: Arc<AtomicBool>,
    definitions_loaded: Arc<AtomicBool>,
    cache_recorder: Arc<RwLock<Option<Arc<dyn DefinitionCacheRecorder>>>>,
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
            last_modified: Arc::new(RwLock::new(None)),
            last_timestamp: Arc::new(RwLock::new(None)),
            last_error: Arc::new(RwLock::new(None)),
            last_error_time: Arc::new(RwLock::new(None)),
            jwks: Arc::new(RwLock::new(None)),
            shutdown_tx: None,
            ws_connected: Arc::new(AtomicBool::new(false)),
            last_fallback_refresh: Arc::new(RwLock::new(Instant::now())),
            refresh_in_flight: Arc::new(AtomicBool::new(false)),
            pending_ws_refresh: Arc::new(AtomicBool::new(false)),
            definitions_loaded: Arc::new(AtomicBool::new(false)),
            cache_recorder: Arc::new(RwLock::new(None)),
        })
    }

    /// Attach a usage recorder for definition-refresh cache hit/miss counts.
    pub fn set_definition_cache_recorder(&self, recorder: Arc<dyn DefinitionCacheRecorder>) {
        *self.cache_recorder.write() = Some(recorder);
    }

    /// Initialize the provider by fetching definitions.
    pub async fn initialize(&mut self) -> crate::Result<()> {
        self.refresh(false, false).await?;

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
        let last_modified = Arc::clone(&self.last_modified);
        let last_timestamp = Arc::clone(&self.last_timestamp);
        let last_error = Arc::clone(&self.last_error);
        let last_error_time = Arc::clone(&self.last_error_time);
        let jwks = Arc::clone(&self.jwks);
        let config = self.config.clone();
        let http_client = self.http_client.clone();
        let refresh_interval = config.refresh_interval;
        let ws_connected = Arc::clone(&self.ws_connected);
        let last_fallback_refresh = Arc::clone(&self.last_fallback_refresh);
        let refresh_in_flight = Arc::clone(&self.refresh_in_flight);
        let pending_ws_refresh = Arc::clone(&self.pending_ws_refresh);
        let definitions_loaded = Arc::clone(&self.definitions_loaded);
        let cache_recorder = Arc::clone(&self.cache_recorder);

        if config.enable_live_updates {
            let ws_definitions = Arc::clone(&definitions);
            let ws_last_fetch = Arc::clone(&last_fetch);
            let ws_etag = Arc::clone(&etag);
            let ws_last_modified = Arc::clone(&last_modified);
            let ws_last_timestamp = Arc::clone(&last_timestamp);
            let ws_last_error = Arc::clone(&last_error);
            let ws_last_error_time = Arc::clone(&last_error_time);
            let ws_jwks = Arc::clone(&jwks);
            let ws_config = config.clone();
            let ws_http_client = http_client.clone();
            let ws_connected_flag = Arc::clone(&ws_connected);
            let ws_last_fallback = Arc::clone(&last_fallback_refresh);
            let ws_refresh_in_flight = Arc::clone(&refresh_in_flight);
            let ws_pending = Arc::clone(&pending_ws_refresh);
            let ws_loaded = Arc::clone(&definitions_loaded);
            let ws_recorder = Arc::clone(&cache_recorder);
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
                                                        &ws_last_modified,
                                                        &ws_last_timestamp,
                                                        &ws_last_error,
                                                        &ws_last_error_time,
                                                        &ws_jwks,
                                                        &ws_refresh_in_flight,
                                                        &ws_pending,
                                                        &ws_loaded,
                                                        &ws_recorder,
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
                                // Skipped poll (live WS / in-memory still valid) = cache hit.
                                Self::record_hit(&cache_recorder);
                                continue;
                            }
                            *last_fallback_refresh.write() = Instant::now();
                            debug!("WebSocket connected, performing fallback refresh");
                        }

                        if let Err(e) = Self::refresh_impl(
                            &http_client,
                            &config,
                            &definitions,
                            &last_fetch,
                            &etag,
                            &last_modified,
                            &last_timestamp,
                            &last_error,
                            &last_error_time,
                            &jwks,
                            &refresh_in_flight,
                            &pending_ws_refresh,
                            &definitions_loaded,
                            &cache_recorder,
                            false,
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
    #[allow(clippy::too_many_arguments)]
    async fn handle_ws_message(
        text: &str,
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        definitions: &DashMap<String, FeatureDefinition>,
        last_fetch: &RwLock<Option<Instant>>,
        etag: &RwLock<Option<String>>,
        last_modified: &RwLock<Option<String>>,
        last_timestamp: &RwLock<Option<i64>>,
        last_error: &RwLock<Option<String>>,
        last_error_time: &RwLock<Option<DateTime<Utc>>>,
        jwks: &RwLock<Option<JwksCache>>,
        refresh_in_flight: &AtomicBool,
        pending_ws_refresh: &AtomicBool,
        definitions_loaded: &AtomicBool,
        cache_recorder: &RwLock<Option<Arc<dyn DefinitionCacheRecorder>>>,
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
                    // WS-forced refresh must not be suppressed by scheduled poll skip.
                    if let Err(e) = Self::refresh_impl(
                        http_client,
                        config,
                        definitions,
                        last_fetch,
                        etag,
                        last_modified,
                        last_timestamp,
                        last_error,
                        last_error_time,
                        jwks,
                        refresh_in_flight,
                        pending_ws_refresh,
                        definitions_loaded,
                        cache_recorder,
                        true,
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
            if let Err(e) = Self::refresh_impl(
                http_client,
                config,
                definitions,
                last_fetch,
                etag,
                last_modified,
                last_timestamp,
                last_error,
                last_error_time,
                jwks,
                refresh_in_flight,
                pending_ws_refresh,
                definitions_loaded,
                cache_recorder,
                true,
                false,
            )
            .await
            {
                error!(error = %e, "WebSocket-triggered refresh failed");
            }
        }
    }

    /// Fetch definitions from the API (counts one cache hit/miss outcome).
    pub async fn fetch_definitions(&self) -> crate::Result<()> {
        self.refresh(false, false).await
    }

    /// Refresh definitions once. Concurrent in-flight skips do not count.
    ///
    /// `from_websocket` forces a network attempt even when scheduled polls would skip.
    pub async fn refresh(
        &self,
        from_websocket: bool,
        force_jwks_refresh: bool,
    ) -> crate::Result<()> {
        Self::refresh_impl(
            &self.http_client,
            &self.config,
            &self.definitions,
            &self.last_fetch,
            &self.etag,
            &self.last_modified,
            &self.last_timestamp,
            &self.last_error,
            &self.last_error_time,
            &self.jwks,
            &self.refresh_in_flight,
            &self.pending_ws_refresh,
            &self.definitions_loaded,
            &self.cache_recorder,
            from_websocket,
            force_jwks_refresh,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn refresh_impl(
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        definitions: &DashMap<String, FeatureDefinition>,
        last_fetch: &RwLock<Option<Instant>>,
        etag: &RwLock<Option<String>>,
        last_modified: &RwLock<Option<String>>,
        last_timestamp: &RwLock<Option<i64>>,
        last_error: &RwLock<Option<String>>,
        last_error_time: &RwLock<Option<DateTime<Utc>>>,
        jwks: &RwLock<Option<JwksCache>>,
        refresh_in_flight: &AtomicBool,
        pending_ws_refresh: &AtomicBool,
        definitions_loaded: &AtomicBool,
        cache_recorder: &RwLock<Option<Arc<dyn DefinitionCacheRecorder>>>,
        from_websocket: bool,
        force_jwks_refresh: bool,
    ) -> crate::Result<()> {
        // Concurrent refresh skipped (in flight) — do not count.
        if refresh_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            if from_websocket {
                pending_ws_refresh.store(true, Ordering::SeqCst);
            }
            return Ok(());
        }

        let result = Self::fetch_definitions_impl(
            http_client,
            config,
            definitions,
            last_fetch,
            etag,
            last_modified,
            last_timestamp,
            last_error,
            last_error_time,
            jwks,
            definitions_loaded,
            force_jwks_refresh,
        )
        .await;

        match &result {
            Ok(RefreshCacheOutcome::Hit) => Self::record_hit(cache_recorder),
            Ok(RefreshCacheOutcome::Miss) => Self::record_miss(cache_recorder),
            Err(_) => {
                // Network error / timeout keeping last-good revision (incl. empty) — hit.
                if definitions_loaded.load(Ordering::SeqCst) {
                    Self::record_hit(cache_recorder);
                }
            }
        }

        refresh_in_flight.store(false, Ordering::SeqCst);
        if pending_ws_refresh.swap(false, Ordering::SeqCst) {
            // Drain WS notifies that arrived while in flight (no count on the skip).
            let _ = Box::pin(Self::refresh_impl(
                http_client,
                config,
                definitions,
                last_fetch,
                etag,
                last_modified,
                last_timestamp,
                last_error,
                last_error_time,
                jwks,
                refresh_in_flight,
                pending_ws_refresh,
                definitions_loaded,
                cache_recorder,
                true,
                false,
            ))
            .await;
        }

        result.map(|_| ())
    }

    fn record_hit(cache_recorder: &RwLock<Option<Arc<dyn DefinitionCacheRecorder>>>) {
        if let Some(r) = cache_recorder.read().as_ref() {
            r.record_definition_cache_hit();
        }
    }

    fn record_miss(cache_recorder: &RwLock<Option<Arc<dyn DefinitionCacheRecorder>>>) {
        if let Some(r) = cache_recorder.read().as_ref() {
            r.record_definition_cache_miss();
        }
    }

    /// Clear in-memory definitions, ETag/revision, and cached JWKS.
    pub fn clear(&self) {
        self.definitions.clear();
        *self.etag.write() = None;
        *self.last_modified.write() = None;
        *self.last_timestamp.write() = None;
        *self.jwks.write() = None;
        self.definitions_loaded.store(false, Ordering::SeqCst);
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

    /// True when a revision has been successfully loaded (including empty `{}`).
    pub fn definitions_loaded(&self) -> bool {
        self.definitions_loaded.load(Ordering::SeqCst)
    }

    /// Test helper: mark WebSocket connected with a recent fallback timestamp.
    #[cfg(test)]
    pub fn set_ws_connected_for_test(&self, connected: bool) {
        self.ws_connected.store(connected, Ordering::SeqCst);
        if connected {
            *self.last_fallback_refresh.write() = Instant::now();
        }
    }

    /// Test helper: whether a scheduled poll would skip while WS is live.
    #[cfg(test)]
    pub fn should_skip_refresh_for_test(&self) -> bool {
        if !self.ws_connected.load(Ordering::SeqCst) {
            return false;
        }
        self.last_fallback_refresh.read().elapsed()
            < Duration::from_secs(WS_FALLBACK_REFRESH_SECS)
    }

    /// Test helper: force the in-flight guard (concurrent skip).
    #[cfg(test)]
    pub fn set_refresh_in_flight_for_test(&self, in_flight: bool) {
        self.refresh_in_flight.store(in_flight, Ordering::SeqCst);
    }

    /// Test helper: set signed timestamp without applying defs.
    #[cfg(test)]
    pub fn set_last_timestamp_for_test(&self, ts: i64) {
        *self.last_timestamp.write() = Some(ts);
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

    fn store_revision_headers(
        etag: &RwLock<Option<String>>,
        last_modified: &RwLock<Option<String>>,
        response_etag: Option<String>,
        response_lm: Option<String>,
    ) {
        if let Some(rev) = response_etag.filter(|s| !s.is_empty()) {
            *etag.write() = Some(rev);
        }
        if let Some(lm) = response_lm.filter(|s| !s.is_empty()) {
            *last_modified.write() = Some(lm);
        }
    }

    fn apply_definitions(
        definitions: &DashMap<String, FeatureDefinition>,
        parsed: Vec<FeatureDefinition>,
        definitions_loaded: &AtomicBool,
    ) {
        definitions.clear();
        for definition in parsed {
            definitions.insert(definition.feature_key.clone(), definition);
        }
        definitions_loaded.store(true, Ordering::SeqCst);
        info!(count = definitions.len(), "Loaded feature definitions");
    }

    /// Internal implementation of fetch_definitions (one outcome, no double-count).
    #[allow(clippy::too_many_arguments)]
    async fn fetch_definitions_impl(
        http_client: &reqwest::Client,
        config: &TogglyConfig,
        definitions: &DashMap<String, FeatureDefinition>,
        last_fetch: &RwLock<Option<Instant>>,
        etag: &RwLock<Option<String>>,
        last_modified: &RwLock<Option<String>>,
        last_timestamp: &RwLock<Option<i64>>,
        last_error: &RwLock<Option<String>>,
        last_error_time: &RwLock<Option<DateTime<Utc>>>,
        jwks: &RwLock<Option<JwksCache>>,
        definitions_loaded: &AtomicBool,
        force_jwks_refresh: bool,
    ) -> crate::Result<RefreshCacheOutcome> {
        if force_jwks_refresh {
            Self::clear_jwks(jwks, etag);
        }

        let url = config.definitions_endpoint();
        debug!(url = %url, "Fetching definitions");

        let existing_etag = etag.read().clone();
        let existing_lm = last_modified.read().clone();

        let mut request = http_client.get(&url);
        if let Some(ref e) = existing_etag {
            request = request.header("If-None-Match", e.clone());
        }
        if let Some(ref lm) = existing_lm {
            request = request.header("If-Modified-Since", lm.clone());
        }

        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                let err = crate::Error::from(e);
                Self::record_error(config, last_error, last_error_time, &err);
                return Err(err);
            }
        };

        let status = response.status().as_u16();
        let response_etag = response
            .headers()
            .get(DEFINITIONS_REVISION_HEADER)
            .or_else(|| response.headers().get("etag"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let response_lm = response
            .headers()
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let kind = classify_http(
            status,
            existing_etag.as_deref(),
            response_etag.as_deref(),
            existing_lm.as_deref(),
            response_lm.as_deref(),
        );

        match kind {
            HttpCacheKind::NotModified => {
                debug!("Definitions not modified (304)");
                *last_fetch.write() = Some(Instant::now());
                return Ok(RefreshCacheOutcome::Hit);
            }
            HttpCacheKind::SameRevision => {
                debug!("Definitions revision matches existing (ETag or Last-Modified)");
                Self::store_revision_headers(etag, last_modified, response_etag, response_lm);
                *last_fetch.write() = Some(Instant::now());
                return Ok(RefreshCacheOutcome::Hit);
            }
            HttpCacheKind::ErrorStatus => {
                let err = crate::Error::Provider(format!(
                    "Failed to fetch definitions: {}",
                    response.status()
                ));
                Self::record_error(config, last_error, last_error_time, &err);
                return Err(err);
            }
            HttpCacheKind::NewContent => {}
        }

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
                    if cached_signed_timestamp(current_ts, ts) {
                        debug!(
                            ?current_ts,
                            ts, "Ignoring signed definitions with equal or older timestamp"
                        );
                        Self::store_revision_headers(
                            etag,
                            last_modified,
                            response_etag,
                            response_lm,
                        );
                        *last_fetch.write() = Some(Instant::now());
                        return Ok(RefreshCacheOutcome::Hit);
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
            // Unsigned path: still treat equal signed timestamp in JSON as hit when present.
            let body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
                Ok(v) => v,
                Err(e) => {
                    let err = crate::Error::from(e);
                    Self::record_error(config, last_error, last_error_time, &err);
                    return Err(err);
                }
            };
            if let Some(ts) = body.get("timestamp").and_then(|v| v.as_i64()) {
                let current_ts = *last_timestamp.read();
                if cached_signed_timestamp(current_ts, ts) {
                    debug!(
                        ?current_ts,
                        ts, "Ignoring definitions with equal or older signed timestamp"
                    );
                    Self::store_revision_headers(etag, last_modified, response_etag, response_lm);
                    *last_fetch.write() = Some(Instant::now());
                    return Ok(RefreshCacheOutcome::Hit);
                }
            }
            match Self::parse_definitions_payload(body) {
                Ok(defs) => defs,
                Err(e) => {
                    Self::record_error(config, last_error, last_error_time, &e);
                    return Err(e);
                }
            }
        };

        Self::store_revision_headers(etag, last_modified, response_etag, response_lm);
        Self::apply_definitions(definitions, parsed_definitions, definitions_loaded);

        *last_fetch.write() = Some(Instant::now());
        *last_error.write() = None;
        *last_error_time.write() = None;
        Ok(RefreshCacheOutcome::Miss)
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

            // Signed envelope already unwrapped; map of featureKey → def, or empty object.
            if obj.contains_key("defs") || obj.contains_key("features") {
                let features = obj
                    .get("defs")
                    .or_else(|| obj.get("features"))
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                return Self::parse_definitions_payload(features);
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
    use crate::definition_cache::DefinitionCacheRecorder;
    use crate::telemetry::{
        FeatureStatPayload, TelemetryRuntime, TelemetryRuntimeConfig, TelemetrySenders, UsageSender,
    };
    use async_trait::async_trait;
    use parking_lot::Mutex as PlMutex;
    use std::sync::Mutex as StdMutex;
    use wiremock::matchers::{method, path_regex};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    struct CountingRecorder {
        hits: PlMutex<i32>,
        misses: PlMutex<i32>,
    }

    impl CountingRecorder {
        fn new() -> Self {
            Self {
                hits: PlMutex::new(0),
                misses: PlMutex::new(0),
            }
        }

        fn snapshot(&self) -> (i32, i32) {
            (*self.hits.lock(), *self.misses.lock())
        }
    }

    impl DefinitionCacheRecorder for CountingRecorder {
        fn record_definition_cache_hit(&self) {
            *self.hits.lock() += 1;
        }

        fn record_definition_cache_miss(&self) {
            *self.misses.lock() += 1;
        }
    }

    fn feature_json(key: &str) -> serde_json::Value {
        serde_json::json!([{
            "featureKey": key,
            "filters": [{"name": "AlwaysOn", "parameters": {}}],
            "metrics": [],
            "securedFeature": false,
            "clientSdkEnabled": true,
            "requirementType": "Any"
        }])
    }

    async fn provider_against(server: &MockServer) -> DefinitionsProvider {
        let config = TogglyConfig::builder()
            .app_key("app")
            .environment("Production")
            .definitions_url(format!("{}/", server.uri()))
            .disable_background_refresh(true)
            .enable_live_updates(false)
            .build();
        DefinitionsProvider::new(config).unwrap()
    }

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
                context_kind: None,
                context_requirement_type: None,
            },
        );
        *provider.etag.write() = Some("rev1".into());
        provider.definitions_loaded.store(true, Ordering::SeqCst);
        *provider.jwks.write() = Some(JwksCache {
            set: JwkSet { keys: vec![] },
            expiry: Instant::now() + Duration::from_secs(60),
        });

        provider.clear();

        assert!(provider.is_empty());
        assert!(provider.etag().is_none());
        assert!(!provider.definitions_loaded());
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
            format!(
                "wss://definitions.toggly.io/my-app/ws?sdk=rust&sdkVersion={}",
                env!("CARGO_PKG_VERSION")
            )
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
            format!(
                "wss://custom.example.com/my-app/ws?rev=rev123&sdk=rust&sdkVersion={}",
                env!("CARGO_PKG_VERSION")
            )
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
            format!(
                "ws://localhost:8080/my-app/ws?sdk=rust&sdkVersion={}",
                env!("CARGO_PKG_VERSION")
            )
        );
    }

    #[tokio::test]
    async fn refresh_304_is_hit_and_new_200_is_miss() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"1\"")
                    .set_body_json(feature_json("feat-a")),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(ResponseTemplate::new(304).insert_header("etag", "\"1\""))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"2\"")
                    .set_body_json(feature_json("feat-b")),
            )
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());

        provider.refresh(false, false).await.unwrap();
        assert_eq!(rec.snapshot(), (0, 1));

        provider.refresh(false, false).await.unwrap();
        assert_eq!(rec.snapshot(), (1, 1));

        provider.refresh(true, false).await.unwrap();
        assert_eq!(rec.snapshot(), (1, 2));
        assert!(provider.contains("feat-b"));
    }

    #[tokio::test]
    async fn equal_etag_is_hit() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"abc\"")
                    .set_body_json(feature_json("feat-a")),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "W/\"abc\"")
                    .set_body_json(feature_json("feat-a")),
            )
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        provider.refresh(false, false).await.unwrap();
        provider.refresh(true, false).await.unwrap();
        assert_eq!(rec.snapshot(), (1, 1));
    }

    #[tokio::test]
    async fn equal_last_modified_is_hit() {
        let lm = "Mon, 01 Jan 2024 00:00:00 GMT";
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"1\"")
                    .insert_header("last-modified", lm)
                    .set_body_json(feature_json("feat-a")),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"different\"")
                    .insert_header("last-modified", lm)
                    .set_body_json(feature_json("feat-a")),
            )
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        provider.refresh(false, false).await.unwrap();
        provider.refresh(true, false).await.unwrap();
        assert_eq!(rec.snapshot(), (1, 1));
    }

    #[tokio::test]
    async fn equal_signed_timestamp_is_hit() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"replay\"")
                    .set_body_json(serde_json::json!({
                        "defs": feature_json("feat-a"),
                        "signature": "unused",
                        "timestamp": 1_700_000_000_i64,
                        "kid": "k1"
                    })),
            )
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        *provider.etag.write() = Some("\"prior\"".into());
        provider.set_last_timestamp_for_test(1_700_000_000);
        provider.refresh(true, false).await.unwrap();
        assert_eq!(rec.snapshot(), (1, 0));
    }

    #[tokio::test]
    async fn network_error_keeps_cache_as_hit_including_empty_revision() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"empty\"")
                    .set_body_json(serde_json::json!([])),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        provider.refresh(false, false).await.unwrap();
        assert_eq!(rec.snapshot(), (0, 1));
        assert!(provider.definitions_loaded());
        assert!(provider.is_empty());

        let _ = provider.refresh(false, false).await;
        assert_eq!(rec.snapshot(), (1, 1));
    }

    #[tokio::test]
    async fn initial_network_failure_without_cache_does_not_count() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        let _ = provider.refresh(false, false).await;
        assert_eq!(rec.snapshot(), (0, 0));
    }

    #[tokio::test]
    async fn concurrent_inflight_skip_does_not_count() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"1\"")
                    .set_body_json(feature_json("feat-a")),
            )
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        provider.set_refresh_in_flight_for_test(true);
        provider.refresh(true, false).await.unwrap();
        provider.refresh(false, false).await.unwrap();
        assert_eq!(rec.snapshot(), (0, 0));
        provider.set_refresh_in_flight_for_test(false);
    }

    #[tokio::test]
    async fn skipped_poll_helper_and_ws_force_miss() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path_regex(r"/definitions/.+"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("etag", "\"ws-1\"")
                    .set_body_json(feature_json("feat-a")),
            )
            .mount(&server)
            .await;

        let provider = provider_against(&server).await;
        let rec = Arc::new(CountingRecorder::new());
        provider.set_definition_cache_recorder(rec.clone());
        provider.set_ws_connected_for_test(true);
        assert!(provider.should_skip_refresh_for_test());
        DefinitionsProvider::record_hit(&provider.cache_recorder);
        assert_eq!(rec.snapshot(), (1, 0));

        provider.refresh(true, false).await.unwrap();
        assert_eq!(rec.snapshot(), (1, 1));
    }

    #[tokio::test]
    async fn usage_batcher_flushes_cache_only_and_restores_on_fail() {
        struct ControllableUsage {
            payloads: StdMutex<Vec<FeatureStatPayload>>,
            fail_next: StdMutex<bool>,
        }

        #[async_trait]
        impl UsageSender for ControllableUsage {
            async fn send_stats(&self, payload: &FeatureStatPayload) -> Result<(), String> {
                let mut fail = self.fail_next.lock().unwrap();
                if *fail {
                    *fail = false;
                    return Err("boom".into());
                }
                self.payloads.lock().unwrap().push(payload.clone());
                Ok(())
            }
        }

        let sender = Arc::new(ControllableUsage {
            payloads: StdMutex::new(Vec::new()),
            fail_next: StdMutex::new(false),
        });
        let mut config = TelemetryRuntimeConfig::from_client_config(
            "app",
            "Production",
            None,
            Some(true),
            Some(false),
            Some(Duration::from_secs(0)),
            Some(Duration::from_secs(0)),
            None,
            None,
        );
        config.senders = TelemetrySenders {
            usage: Some(sender.clone()),
            metrics: None,
        };
        config.senders_provided = true;
        let runtime = TelemetryRuntime::start(config);

        runtime.record_definition_cache_hit();
        *sender.fail_next.lock().unwrap() = true;
        runtime.flush_all().await;
        assert!(sender.payloads.lock().unwrap().is_empty());

        runtime.record_definition_cache_miss();
        runtime.flush_all().await;
        let payloads = sender.payloads.lock().unwrap();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].definition_cache_hits, Some(1));
        assert_eq!(payloads[0].definition_cache_misses, Some(1));
        assert!(payloads[0].stats.is_empty());
        runtime.close().await;
    }
}
