//! Main Toggly client.

use crate::cache::Cache;
use crate::config::{TogglyConfig, TogglyConfigBuilder};
use crate::context::EvalContext;
use crate::eval::{assign_variant, Engine, VariantAssignment};
use crate::provider::DefinitionsProvider;
use crate::telemetry::{
    MetricsFeatureOptions, TelemetryRuntime, TelemetryRuntimeConfig, TelemetrySenders,
};
use crate::Requirement;
use parking_lot::RwLock;
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
    telemetry: Option<Arc<TelemetryRuntime>>,
    /// Mutable default targeting userId (from [`TogglyConfig::identity`],
    /// overridable via [`Self::set_identity`]).
    identity: RwLock<Option<String>>,
}

impl TogglyClient {
    /// Create a new client builder.
    pub fn builder() -> TogglyClientBuilder {
        TogglyClientBuilder::default()
    }

    /// Create a new client with the given configuration.
    pub async fn new(config: TogglyConfig) -> crate::Result<Self> {
        Self::new_with_senders(config, None).await
    }

    /// Create a client with optional injected telemetry senders (tests).
    pub async fn new_with_senders(
        config: TogglyConfig,
        senders: Option<TelemetrySenders>,
    ) -> crate::Result<Self> {
        config.validate()?;

        let mut provider = DefinitionsProvider::new(config.clone())?;

        let cache = Cache::new(config.cache_ttl, config.cache_max_entries);
        crate::entity_context::register_entity_contexts_at_startup(&config).await;

        let mut runtime_config = TelemetryRuntimeConfig::from_client_config(&config);
        if let Some(senders) = senders {
            runtime_config.senders = senders;
            runtime_config.senders_provided = true;
        }
        let telemetry = Arc::new(TelemetryRuntime::start(runtime_config));
        provider.set_definition_cache_recorder(telemetry.clone());
        provider.initialize().await?;

        let identity = RwLock::new(config.identity.clone());
        Ok(Self {
            config,
            provider: Arc::new(tokio::sync::RwLock::new(provider)),
            engine: Engine::with_defaults(),
            cache,
            telemetry: Some(telemetry),
            identity,
        })
    }

    /// Get the configuration.
    pub fn config(&self) -> &TogglyConfig {
        &self.config
    }

    /// Update the client's default targeting userId used when the per-call
    /// [`EvalContext`] has no identity.
    ///
    /// Groups are never stored here — pass them on ambient/request context or
    /// the per-call override.
    pub fn set_identity(&self, identity: impl Into<String>) {
        *self.identity.write() = Some(identity.into());
    }

    /// Clear the client's default targeting identity.
    pub fn clear_identity(&self) {
        *self.identity.write() = None;
    }

    /// Current default targeting userId (from config / [`Self::set_identity`]).
    pub fn identity(&self) -> Option<String> {
        self.identity.read().clone()
    }

    /// Get the evaluation engine.
    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// Check if a feature is enabled.
    ///
    /// When usage tracking is enabled, each call records a usage check
    /// (including cache hits).
    #[instrument(skip(self, context), fields(feature = %feature_key))]
    pub async fn is_enabled(&self, feature_key: &str, context: EvalContext) -> crate::Result<bool> {
        if feature_key.is_empty() {
            return Err(crate::Error::Config("feature_key is required".to_string()));
        }

        let cache_key = self.cache_key(feature_key, &context);
        if let Some(cached) = self.cache.get(&cache_key) {
            debug!(feature = %feature_key, cached = %cached, "Cache hit");
            self.record_check(feature_key, cached, context.identity.as_deref());
            return Ok(cached);
        }

        let provider = self.provider.read().await;
        let definition = match provider.get(feature_key) {
            Some(def) => def,
            None => {
                let result = if self.config.enable_undefined_in_dev {
                    debug!(feature = %feature_key, "Feature not found, returning true (dev mode)");
                    true
                } else {
                    debug!(feature = %feature_key, "Feature not found, returning false");
                    false
                };
                self.record_check(feature_key, result, context.identity.as_deref());
                return Ok(result);
            }
        };
        drop(provider);

        let result = self.engine.evaluate(&definition, &context)?;
        self.cache.insert(cache_key, result);

        debug!(feature = %feature_key, enabled = %result, "Feature evaluated");
        self.record_check(feature_key, result, context.identity.as_deref());
        Ok(result)
    }

    /// Check if a feature is disabled.
    pub async fn is_disabled(
        &self,
        feature_key: &str,
        context: EvalContext,
    ) -> crate::Result<bool> {
        Ok(!self.is_enabled(feature_key, context).await?)
    }

    /// Assign a feature variant, matching `Microsoft.FeatureManagement`
    /// (`IVariantFeatureManager`) bit-for-bit for the same definition,
    /// enabled state, and targeting context.
    ///
    /// Assigns locally from the cached definitions catalog (`variants` +
    /// `allocation`); no network call and no dependency on
    /// `evaluated-variants-signed`. Records a usage check (variant-tagged)
    /// when usage tracking is enabled.
    ///
    /// Targeting identity resolution (first non-empty wins):
    /// 1. per-call `context.identity`
    /// 2. [`TogglyConfig::identity`] / [`Self::set_identity`]
    ///
    /// Prefer `get_variant(key, EvalContext::default())` after setting config
    /// or client identity, or pass a request-scoped context from the HTTP
    /// adapters — not a hand-built identity on every call. Groups come only
    /// from ambient/request or the per-call override (never config).
    #[instrument(skip(self, context), fields(feature = %feature_key))]
    pub async fn get_variant(
        &self,
        feature_key: &str,
        context: EvalContext,
    ) -> crate::Result<VariantAssignment> {
        if feature_key.is_empty() {
            return Err(crate::Error::Config("feature_key is required".to_string()));
        }

        let context = self.resolve_targeting_context(context);

        let provider = self.provider.read().await;
        let definition = match provider.get(feature_key) {
            Some(def) => def,
            None => {
                let enabled = self.config.enable_undefined_in_dev;
                self.record_check(feature_key, enabled, context.identity.as_deref());
                return Ok(VariantAssignment {
                    variant_name: None,
                    configuration_value: None,
                    enabled,
                    assignment_reason: crate::eval::AssignmentReason::None,
                });
            }
        };
        drop(provider);

        let filter_enabled = self.engine.evaluate(&definition, &context)?;
        let assignment = assign_variant(
            &definition,
            filter_enabled,
            &context,
            self.config.variant_ignore_case,
        );

        debug!(
            feature = %feature_key,
            variant = ?assignment.variant_name,
            enabled = %assignment.enabled,
            reason = %assignment.assignment_reason,
            "Variant assigned"
        );
        self.record_variant_check(
            feature_key,
            assignment.enabled,
            context.identity.as_deref(),
            assignment.variant_name.as_deref(),
        );
        Ok(assignment)
    }

    /// Get the assigned variant's configuration payload, or `None` if no
    /// variant was assigned. See [`Self::get_variant`] for identity resolution.
    pub async fn get_variant_value(
        &self,
        feature_key: &str,
        context: EvalContext,
    ) -> crate::Result<Option<serde_json::Value>> {
        Ok(self
            .get_variant(feature_key, context)
            .await?
            .configuration_value)
    }

    /// Evaluate a feature gate (multiple features with AND/OR logic).
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
    pub fn is_defined_sync(&self, feature_key: &str) -> bool {
        match self.provider.try_read() {
            Ok(guard) => guard.contains(feature_key),
            Err(_) => {
                debug!(feature = %feature_key, "Could not acquire lock for sync check");
                false
            }
        }
    }

    /// Force a refresh of feature definitions.
    pub async fn refresh(&self) -> crate::Result<()> {
        self.provider.read().await.refresh(false, false).await?;
        self.cache.clear();
        info!("Feature definitions refreshed");
        Ok(())
    }

    /// Force a refresh, optionally marking the attempt as WebSocket-driven.
    pub async fn refresh_from_websocket(&self) -> crate::Result<()> {
        self.provider.read().await.refresh(true, false).await?;
        self.cache.clear();
        info!("Feature definitions refreshed (websocket)");
        Ok(())
    }

    /// Clear the evaluation cache and in-memory definitions / JWKS.
    pub async fn clear_cache(&self) {
        self.cache.clear();
        self.provider.write().await.clear();
    }

    /// Last definitions refresh error, if any.
    pub async fn last_error(&self) -> Option<String> {
        self.provider.read().await.last_error()
    }

    /// Cached definitions revision / ETag.
    pub async fn etag(&self) -> Option<String> {
        self.provider.read().await.etag()
    }

    /// Record a feature used/interaction event.
    pub fn record_usage(&self, feature_key: &str, identity: Option<&str>, variant: &str) {
        if let Some(tel) = &self.telemetry {
            if tel.usage_enabled() {
                tel.record_usage(feature_key, identity, variant);
            }
        }
    }

    /// Record a feature viewed/rendered event.
    pub fn record_view(&self, feature_key: &str, identity: Option<&str>, variant: &str) {
        if let Some(tel) = &self.telemetry {
            if tel.usage_enabled() {
                tel.record_view(feature_key, identity, variant);
            }
        }
    }

    /// Aggregate a business measurement (sum over the flush window).
    pub fn measure(&self, metric: &str, value: f64, options: Option<&MetricsFeatureOptions>) {
        if let Some(tel) = &self.telemetry {
            if tel.metrics_enabled() {
                tel.measure(metric, value, options);
            }
        }
    }

    /// Increment a business counter.
    pub fn increment_counter(
        &self,
        metric: &str,
        value: f64,
        options: Option<&MetricsFeatureOptions>,
    ) {
        if let Some(tel) = &self.telemetry {
            if tel.metrics_enabled() {
                tel.increment_counter(metric, value, options);
            }
        }
    }

    /// Record a point-in-time business observation.
    pub fn observe(&self, metric: &str, value: f64, options: Option<&MetricsFeatureOptions>) {
        if let Some(tel) = &self.telemetry {
            if tel.metrics_enabled() {
                tel.observe(metric, value, options);
            }
        }
    }

    /// Flush pending usage and metrics batches (soft-fail on transport errors).
    pub async fn flush_telemetry(&self) {
        if let Some(tel) = &self.telemetry {
            tel.flush_all().await;
        }
    }

    /// Close the client and release resources (best-effort telemetry flush).
    pub async fn close(&self) {
        if let Some(tel) = &self.telemetry {
            tel.close().await;
        }
        self.provider.write().await.shutdown();
        self.cache.clear();
        info!("Toggly client closed");
    }

    fn record_check(&self, feature_key: &str, enabled: bool, identity: Option<&str>) {
        if let Some(tel) = &self.telemetry {
            if tel.usage_enabled() {
                tel.record_check(feature_key, enabled, identity, None, false);
            }
        }
    }

    fn record_variant_check(
        &self,
        feature_key: &str,
        enabled: bool,
        identity: Option<&str>,
        variant: Option<&str>,
    ) {
        if let Some(tel) = &self.telemetry {
            if tel.usage_enabled() {
                tel.record_check(feature_key, enabled, identity, variant, false);
            }
        }
    }

    fn cache_key(&self, feature_key: &str, context: &EvalContext) -> String {
        let identity = context.identity.as_deref().unwrap_or("");
        let groups = context.groups.join(",");
        format!("{feature_key}:{identity}:{groups}")
    }

    /// Fill empty per-call identity from the client default (config /
    /// [`Self::set_identity`]). Non-empty per-call identity wins; groups are
    /// never filled from config.
    fn resolve_targeting_context(&self, mut context: EvalContext) -> EvalContext {
        if !context.has_identity() {
            if let Some(id) = self.identity.read().as_ref() {
                if !id.is_empty() {
                    context.identity = Some(id.clone());
                }
            }
        }
        context
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

    /// Restrict accepted signing key IDs.
    pub fn allowed_key_ids(mut self, kids: std::collections::HashSet<String>) -> Self {
        self.config_builder = self.config_builder.allowed_key_ids(kids);
        self
    }

    /// Set an error callback for refresh / verification failures.
    pub fn on_error(mut self, callback: crate::config::OnErrorCallback) -> Self {
        self.config_builder = self.config_builder.on_error(callback);
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

    /// Enable or disable feature usage tracking.
    pub fn enable_usage_tracking(mut self, enabled: bool) -> Self {
        self.config_builder = self.config_builder.enable_usage_tracking(enabled);
        self
    }

    /// Enable or disable business metrics export (Toggly gRPC).
    pub fn enable_metrics(mut self, enabled: bool) -> Self {
        self.config_builder = self.config_builder.enable_metrics(enabled);
        self
    }

    /// Enable case-insensitive user/group matching for variant allocation.
    pub fn variant_ignore_case(mut self, enabled: bool) -> Self {
        self.config_builder = self.config_builder.variant_ignore_case(enabled);
        self
    }

    /// Set the default targeting identity for variant assignment.
    pub fn identity(mut self, identity: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.identity(identity);
        self
    }

    /// Set the gRPC base URL for usage/metrics.
    pub fn metrics_base_url(mut self, url: impl Into<String>) -> Self {
        self.config_builder = self.config_builder.metrics_base_url(url);
        self
    }

    /// Set the usage flush interval.
    pub fn usage_flush_interval(mut self, interval: std::time::Duration) -> Self {
        self.config_builder = self.config_builder.usage_flush_interval(interval);
        self
    }

    /// Set the metrics flush interval.
    pub fn metrics_flush_interval(mut self, interval: std::time::Duration) -> Self {
        self.config_builder = self.config_builder.metrics_flush_interval(interval);
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
            .environment("staging")
            .enable_usage_tracking(false)
            .enable_metrics(false);
    }

    #[tokio::test]
    async fn test_empty_feature_key() {
        let _config = TogglyConfig::builder()
            .app_key("test")
            .environment("test")
            .disable_background_refresh(true)
            .build();
    }
}
