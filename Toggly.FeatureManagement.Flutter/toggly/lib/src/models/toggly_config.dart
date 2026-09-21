import '../services/toggly_cache_provider.dart';
import '../local_gates.dart';

/// Toggly configuration model allowing various tweaks on how the package
/// should work to better fit each use-case.
class TogglyConfig {
  /// Toggly.io Client API URL. Already defaults to the correct URL.
  final String baseURI;

  /// Sets the connection timeout for when trying to retrieve the feature flags
  /// values from the Toggly.io Client API.
  final int connectTimeout;

  /// Sets how often should the syncronization [Timer] fire to retrieve the
  /// latest feature flags values from the Toggly.io Client API.
  final int featureFlagsRefreshInterval;

  /// Whitelist of trusted key IDs
  final List<String>? trustedKeyIds;

  /// How long fetched JWKS keys remain valid before the SDK refreshes them.
  ///
  /// Defaults to 30 days. Values under one minute are clamped to one minute.
  final Duration jwksCacheDuration;

  /// Whether to enable WebSocket-based live updates for feature flags.
  /// When enabled, a WebSocket connection is maintained to receive
  /// real-time flag updates, reducing the need for periodic polling.
  final bool enableLiveUpdates;

  /// When true, fetches signed variant assignments from the Client API and
  /// exposes variant lookup APIs on `Toggly`.
  final bool enableVariants;

  /// Send aggregated feature checks and explicit usage/business metrics.
  /// Effective only when Toggly is initialized with an application key.
  final bool enableTelemetry;

  /// Base URL for frontend telemetry ingestion, separate from [baseURI].
  final String metricsBaseUrl;

  /// Base interval between telemetry flushes, before up to 20% jitter.
  /// Must be between 30000 and 60000 milliseconds.
  final int telemetryFlushIntervalMs;

  /// Receives bounded telemetry status codes without event payloads or keys.
  final void Function(String code)? onTelemetryDiagnostic;

  /// Optional persistence backend for caches (flags, variants, JWKS).
  ///
  /// When `null` (the default) the SDK is memory-only and does not support
  /// offline restart. Supply an implementation (e.g. one of the
  /// `feature_flags_toggly_*` companion packages) to persist caches across
  /// app restarts. Offline restart also requires a stable [identity] passed
  /// to `Toggly.init` / `Toggly.setIdentity`.
  ///
  /// When [Toggly.init] is called with `useSignedDefinitions: true` (the
  /// default), flags and variants loaded from this store are re-verified
  /// against JWKS before use.
  final TogglyCacheProvider? cacheProvider;

  /// Optional cap on identity-scoped cache entries (flags, variants, and
  /// Flutter revision keys). When `null` (default) or non-positive, storage
  /// is unlimited. A positive value enables last-accessed LRU eviction via
  /// a sidecar index on [cacheProvider].
  final int? maxCacheKeys;

  /// Device-local gates applied as a read-time AND on worker-evaluated booleans.
  final List<LocalGate>? localGates;

  /// Optional callback for SDK errors that would otherwise only be visible in
  /// debug logs. Use this to report failures to Sentry, Crashlytics, etc.
  final void Function(
    String message,
    Object? error,
    StackTrace? stackTrace,
  )? onError;

  const TogglyConfig({
    this.baseURI = 'https://definitions.toggly.io',
    this.connectTimeout = 5 * 1000,
    this.featureFlagsRefreshInterval = 3 * 60 * 1000,
    this.trustedKeyIds,
    this.jwksCacheDuration = const Duration(days: 30),
    this.enableLiveUpdates = true,
    this.enableVariants = false,
    this.enableTelemetry = true,
    this.metricsBaseUrl = 'https://metrics.toggly.io',
    this.telemetryFlushIntervalMs = 45000,
    this.onTelemetryDiagnostic,
    this.cacheProvider,
    this.maxCacheKeys,
    this.localGates,
    this.onError,
  });
}
