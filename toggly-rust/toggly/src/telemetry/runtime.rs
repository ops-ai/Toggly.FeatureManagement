//! Owns usage + metrics batchers, flush timers, and soft-fail send.

use super::hash::{DEFAULT_METRICS_BASE_URL, DEFAULT_TELEMETRY_FLUSH_SECS};
use super::metrics_batcher::{MetricsBatcher, MetricsFeatureOptions};
use super::transport::TelemetrySenders;
use super::usage_batcher::UsageBatcher;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tracing::{debug, error, warn};

/// Configuration for constructing a [`TelemetryRuntime`].
#[derive(Debug, Clone)]
pub struct TelemetryRuntimeConfig {
    /// Application key.
    pub app_key: String,
    /// Environment name.
    pub environment: String,
    /// gRPC base URL (default `https://app.toggly.io/`).
    pub metrics_base_url: String,
    /// Explicit usage opt-in/out; `None` uses default when recording is allowed.
    pub enable_usage_tracking: Option<bool>,
    /// Explicit metrics opt-in/out; `None` uses the same default as usage.
    pub enable_metrics: Option<bool>,
    /// Usage flush interval (default 60s).
    pub usage_flush_interval: Duration,
    /// Metrics flush interval (default 60s).
    pub metrics_flush_interval: Duration,
    /// Optional instance name.
    pub instance_name: Option<String>,
    /// Optional app version.
    pub app_version: Option<String>,
    /// Optional injected senders (tests / custom transports).
    pub senders: TelemetrySenders,
    /// When true, senders were provided by the caller (skip native dial).
    pub senders_provided: bool,
}

impl TelemetryRuntimeConfig {
    /// Build from client config fields with shared defaults.
    pub fn from_client_config(
        app_key: &str,
        environment: &str,
        metrics_base_url: Option<&str>,
        enable_usage_tracking: Option<bool>,
        enable_metrics: Option<bool>,
        usage_flush_interval: Option<Duration>,
        metrics_flush_interval: Option<Duration>,
        instance_name: Option<&str>,
        app_version: Option<&str>,
    ) -> Self {
        Self {
            app_key: app_key.to_string(),
            environment: environment.to_string(),
            metrics_base_url: normalize_url(
                metrics_base_url.unwrap_or(DEFAULT_METRICS_BASE_URL),
            ),
            enable_usage_tracking,
            enable_metrics,
            usage_flush_interval: usage_flush_interval
                .unwrap_or(Duration::from_secs(DEFAULT_TELEMETRY_FLUSH_SECS)),
            metrics_flush_interval: metrics_flush_interval
                .unwrap_or(Duration::from_secs(DEFAULT_TELEMETRY_FLUSH_SECS)),
            instance_name: instance_name.map(str::to_string),
            app_version: app_version.map(str::to_string),
            senders: TelemetrySenders::default(),
            senders_provided: false,
        }
    }
}

fn normalize_url(url: &str) -> String {
    if url.ends_with('/') {
        url.to_string()
    } else {
        format!("{url}/")
    }
}

fn telemetry_env_disabled() -> bool {
    std::env::var("TOGGLY_DISABLE_TELEMETRY")
        .map(|v| v == "1")
        .unwrap_or(false)
}

fn resolve_enabled(explicit: Option<bool>, default_on: bool) -> bool {
    explicit.unwrap_or(default_on)
}

/// True when recording/export is allowed.
///
/// Without the `telemetry` Cargo feature there is no native transport, so we
/// only allow buffering when the caller injected senders (tests). Otherwise
/// tracking stays off so identity maps cannot grow unbounded.
fn recording_allowed(senders_provided: bool) -> bool {
    #[cfg(feature = "telemetry")]
    {
        let _ = senders_provided;
        true
    }
    #[cfg(not(feature = "telemetry"))]
    {
        senders_provided
    }
}

/// Owns usage + metrics batchers, flush timers, and process-exit flush.
pub struct TelemetryRuntime {
    inner: Arc<Inner>,
}

struct Inner {
    enable_usage: bool,
    enable_metrics: bool,
    metrics_base_url: String,
    senders_provided: bool,
    usage_batcher: Mutex<Option<UsageBatcher>>,
    metrics_batcher: Mutex<Option<MetricsBatcher>>,
    senders: Mutex<TelemetrySenders>,
    sending_usage: AtomicBool,
    sending_metrics: AtomicBool,
    closed: AtomicBool,
    warned_missing_transport: AtomicBool,
    cancel_tx: watch::Sender<bool>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl TelemetryRuntime {
    /// Create and start batchers / flush timers when either side is enabled.
    pub fn start(config: TelemetryRuntimeConfig) -> Self {
        let has_app_key = !config.app_key.is_empty();
        let allowed = recording_allowed(config.senders_provided);
        // Feature-off (no injected senders): defaults stay off — no unbounded buffering.
        let default_on = allowed && has_app_key && !telemetry_env_disabled();

        let mut enable_usage = resolve_enabled(config.enable_usage_tracking, default_on);
        let mut enable_metrics = resolve_enabled(config.enable_metrics, default_on);

        let warn_feature_off = !allowed
            && (config.enable_usage_tracking == Some(true)
                || config.enable_metrics == Some(true));

        if !allowed {
            enable_usage = false;
            enable_metrics = false;
        }

        let (cancel_tx, cancel_rx) = watch::channel(false);

        let inner = Arc::new(Inner {
            enable_usage,
            enable_metrics,
            metrics_base_url: config.metrics_base_url,
            senders_provided: config.senders_provided,
            usage_batcher: Mutex::new(None),
            metrics_batcher: Mutex::new(None),
            senders: Mutex::new(config.senders),
            sending_usage: AtomicBool::new(false),
            sending_metrics: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            warned_missing_transport: AtomicBool::new(false),
            cancel_tx,
            tasks: Mutex::new(Vec::new()),
        });

        let runtime = Self {
            inner: inner.clone(),
        };

        if warn_feature_off {
            runtime.warn_feature_required();
        }

        if !enable_usage && !enable_metrics {
            return runtime;
        }

        if enable_usage {
            *inner.usage_batcher.lock() = Some(UsageBatcher::new(
                config.app_key.clone(),
                config.environment.clone(),
                config.instance_name.clone(),
                config.app_version.clone(),
                None,
            ));
            if !config.usage_flush_interval.is_zero() {
                runtime.spawn_flush_loop(cancel_rx.clone(), config.usage_flush_interval, true);
            }
        }

        if enable_metrics {
            *inner.metrics_batcher.lock() = Some(MetricsBatcher::new(
                config.app_key,
                config.environment,
                config.instance_name,
            ));
            if !config.metrics_flush_interval.is_zero() {
                runtime.spawn_flush_loop(cancel_rx, config.metrics_flush_interval, false);
            }
        }

        runtime
    }

    fn warn_feature_required(&self) {
        if self
            .inner
            .warned_missing_transport
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            warn!(
                "Usage/metrics requested but the optional `telemetry` Cargo feature is off. \
                 Recording is a no-op until you enable `toggly/telemetry` (or inject senders)."
            );
        }
    }

    fn spawn_flush_loop(
        &self,
        mut cancel_rx: watch::Receiver<bool>,
        interval: Duration,
        usage: bool,
    ) {
        let inner = self.inner.clone();
        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            // Skip the immediate first tick.
            ticker.tick().await;
            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        if usage {
                            inner.flush_usage().await;
                        } else {
                            inner.flush_metrics().await;
                        }
                    }
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() {
                            break;
                        }
                    }
                }
            }
        });
        self.inner.tasks.lock().push(handle);
    }

    /// True when usage tracking is active and the runtime is open.
    pub fn usage_enabled(&self) -> bool {
        self.inner.enable_usage && !self.inner.closed.load(Ordering::SeqCst)
    }

    /// True when business metrics tracking is active and the runtime is open.
    pub fn metrics_enabled(&self) -> bool {
        self.inner.enable_metrics && !self.inner.closed.load(Ordering::SeqCst)
    }

    /// Record a feature evaluation check.
    pub fn record_check(
        &self,
        feature: &str,
        enabled: bool,
        identity: Option<&str>,
        variant: Option<&str>,
        unique_request: bool,
    ) {
        if let Some(batcher) = self.inner.usage_batcher.lock().as_ref() {
            batcher.record_check(feature, enabled, identity, variant, unique_request);
        }
    }

    /// Record a feature used/interaction event.
    pub fn record_usage(&self, feature: &str, identity: Option<&str>, variant: &str) {
        if let Some(batcher) = self.inner.usage_batcher.lock().as_ref() {
            batcher.record_usage(feature, identity, variant);
        }
    }

    /// Record a feature viewed/rendered event.
    pub fn record_view(&self, feature: &str, identity: Option<&str>, variant: &str) {
        if let Some(batcher) = self.inner.usage_batcher.lock().as_ref() {
            batcher.record_view(feature, identity, variant);
        }
    }

    /// Aggregate a business measurement.
    pub fn measure(&self, metric: &str, value: f64, options: Option<&MetricsFeatureOptions>) {
        if let Some(batcher) = self.inner.metrics_batcher.lock().as_ref() {
            batcher.measure(metric, value, options);
        }
    }

    /// Increment a business counter.
    pub fn increment_counter(
        &self,
        metric: &str,
        value: f64,
        options: Option<&MetricsFeatureOptions>,
    ) {
        if let Some(batcher) = self.inner.metrics_batcher.lock().as_ref() {
            batcher.increment_counter(metric, value, options);
        }
    }

    /// Record a point-in-time observation.
    pub fn observe(&self, metric: &str, value: f64, options: Option<&MetricsFeatureOptions>) {
        if let Some(batcher) = self.inner.metrics_batcher.lock().as_ref() {
            batcher.observe(metric, value, options);
        }
    }

    /// Flush usage and metrics once (soft-fail on transport errors).
    pub async fn flush_all(&self) {
        self.inner.flush_usage().await;
        self.inner.flush_metrics().await;
    }

    /// Stop timers, flush once, and release batchers.
    pub async fn close(&self) {
        if self
            .inner
            .closed
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let _ = self.inner.cancel_tx.send(true);
        let tasks: Vec<_> = std::mem::take(&mut *self.inner.tasks.lock());
        for task in tasks {
            task.abort();
        }
        self.inner.flush_usage().await;
        self.inner.flush_metrics().await;
        *self.inner.usage_batcher.lock() = None;
        *self.inner.metrics_batcher.lock() = None;
        *self.inner.senders.lock() = TelemetrySenders::default();
    }
}

impl Inner {
    async fn ensure_native_clients(&self) {
        if self.senders_provided {
            return;
        }
        {
            let senders = self.senders.lock();
            if senders.usage.is_some() || senders.metrics.is_some() {
                return;
            }
        }

        #[cfg(feature = "telemetry")]
        {
            match super::transport::NativeGrpcSenders::dial(&self.metrics_base_url, None).await {
                Ok(native) => {
                    *self.senders.lock() = native.into_senders();
                }
                Err(err) => {
                    if self
                        .warned_missing_transport
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                    {
                        warn!(
                            "Failed to create Toggly gRPC clients; telemetry send disabled: {err}"
                        );
                    }
                }
            }
        }

        #[cfg(not(feature = "telemetry"))]
        {
            let _ = &self.metrics_base_url;
        }
    }

    async fn flush_usage(&self) {
        if self
            .sending_usage
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        let empty = {
            let guard = self.usage_batcher.lock();
            match guard.as_ref() {
                Some(b) => b.is_empty(),
                None => true,
            }
        };
        if empty {
            self.sending_usage.store(false, Ordering::SeqCst);
            return;
        }

        self.ensure_native_clients().await;
        let sender = self.senders.lock().usage.clone();
        let Some(sender) = sender else {
            debug!("Usage flush skipped: no gRPC client");
            self.sending_usage.store(false, Ordering::SeqCst);
            return;
        };

        let drained = {
            let guard = self.usage_batcher.lock();
            match guard.as_ref() {
                Some(b) => b.build_and_reset(),
                None => None,
            }
        };
        let Some((payload, snapshot)) = drained else {
            self.sending_usage.store(false, Ordering::SeqCst);
            return;
        };

        if let Err(err) = sender.send_stats(&payload).await {
            error!("Failed to send usage stats: {err}");
            if let Some(batcher) = self.usage_batcher.lock().as_ref() {
                batcher.restore_snapshot(snapshot);
            }
        }

        self.sending_usage.store(false, Ordering::SeqCst);
    }

    async fn flush_metrics(&self) {
        if self
            .sending_metrics
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        let empty = {
            let guard = self.metrics_batcher.lock();
            match guard.as_ref() {
                Some(b) => b.is_empty(),
                None => true,
            }
        };
        if empty {
            self.sending_metrics.store(false, Ordering::SeqCst);
            return;
        }

        self.ensure_native_clients().await;
        let sender = self.senders.lock().metrics.clone();
        let Some(sender) = sender else {
            debug!("Metrics flush skipped: no gRPC client");
            self.sending_metrics.store(false, Ordering::SeqCst);
            return;
        };

        let drained = {
            let guard = self.metrics_batcher.lock();
            match guard.as_ref() {
                Some(b) => b.build_and_reset(),
                None => None,
            }
        };
        let Some((payload, snapshot)) = drained else {
            self.sending_metrics.store(false, Ordering::SeqCst);
            return;
        };

        if let Err(err) = sender.send_metrics(&payload).await {
            error!("Failed to send metrics: {err}");
            if let Some(batcher) = self.metrics_batcher.lock().as_ref() {
                batcher.restore_snapshot(snapshot);
            }
        }

        self.sending_metrics.store(false, Ordering::SeqCst);
    }
}

impl Drop for TelemetryRuntime {
    fn drop(&mut self) {
        let _ = self.inner.cancel_tx.send(true);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let inner = self.inner.clone();
            handle.spawn(async move {
                if inner
                    .closed
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    inner.flush_usage().await;
                    inner.flush_metrics().await;
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::transport::UsageSender;
    use crate::telemetry::usage_batcher::FeatureStatPayload;
    use async_trait::async_trait;
    use std::sync::Mutex as StdMutex;

    struct FailingUsage {
        calls: StdMutex<usize>,
    }

    #[async_trait]
    impl UsageSender for FailingUsage {
        async fn send_stats(&self, _payload: &FeatureStatPayload) -> Result<(), String> {
            *self.calls.lock().unwrap() += 1;
            Err("boom".into())
        }
    }

    #[tokio::test]
    async fn soft_fail_restores_usage_on_send_error() {
        let failing = Arc::new(FailingUsage {
            calls: StdMutex::new(0),
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
            usage: Some(failing.clone()),
            metrics: None,
        };
        config.senders_provided = true;

        let runtime = TelemetryRuntime::start(config);
        assert!(runtime.usage_enabled());
        runtime.record_check("FeatureA", true, Some("user-1"), None, false);
        runtime.flush_all().await;

        assert_eq!(*failing.calls.lock().unwrap(), 1);
        runtime.flush_all().await;
        assert_eq!(*failing.calls.lock().unwrap(), 2);
        runtime.close().await;
    }

    #[tokio::test]
    async fn feature_off_without_senders_does_not_buffer() {
        // Without `telemetry` feature and without injected senders, even an
        // explicit enable must no-op (no batcher / no identity growth).
        #[cfg(not(feature = "telemetry"))]
        {
            let config = TelemetryRuntimeConfig::from_client_config(
                "app",
                "Production",
                None,
                Some(true),
                Some(true),
                Some(Duration::from_secs(0)),
                Some(Duration::from_secs(0)),
                None,
                None,
            );
            let runtime = TelemetryRuntime::start(config);
            assert!(!runtime.usage_enabled());
            assert!(!runtime.metrics_enabled());
            runtime.record_check("FeatureA", true, Some("user-1"), None, false);
            runtime.record_usage("FeatureA", Some("user-1"), "enabled");
            runtime.measure("m", 1.0, None);
            // No batchers — flush is a no-op.
            runtime.flush_all().await;
            runtime.close().await;
        }
        #[cfg(feature = "telemetry")]
        {
            // With feature on, defaults/explicit enable create batchers.
            let config = TelemetryRuntimeConfig::from_client_config(
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
            let runtime = TelemetryRuntime::start(config);
            assert!(runtime.usage_enabled());
            runtime.close().await;
        }
    }
}
