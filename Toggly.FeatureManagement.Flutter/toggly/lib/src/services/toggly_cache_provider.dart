import '../models/toggly_cache_models.dart';

/// Contract for persisting Toggly cache data across app restarts.
///
/// The Toggly SDK is memory-only by default. Supply an implementation via
/// [TogglyConfig.cacheProvider] to enable offline support across cold starts.
/// When a provider is supplied, the SDK mirrors its in-memory caches through
/// to the provider and reads from it on cold start / cache miss.
///
/// Offline restart additionally requires a stable `identity` to be passed to
/// `Toggly.init` / `Toggly.setIdentity` — the ephemeral in-memory identity
/// generated when none is provided changes on every cold start, so cached
/// entries would not be found.
///
/// Implementations should be resilient: a read for a missing key must return
/// `null`, and corrupt or undecodable payloads should be treated as a miss
/// (return `null`) rather than throwing.
///
/// The SDK chooses where storage lives by delegating entirely to the
/// implementation. Persisted flags and variants carry their signature
/// metadata (timestamp, signature, keyId) so the SDK can re-verify signed
/// definitions offline. JWKS are public keys and are stored as a raw JSON
/// string.
abstract class TogglyCacheProvider {
  /// Returns the cached feature flags for [identity], or `null` if none.
  Future<TogglyFeatureFlagsCache?> readFlags(String identity);

  /// Persists the feature flags [cache] (keyed by [cache.identity]).
  Future<void> writeFlags(TogglyFeatureFlagsCache cache);

  /// Removes any cached feature flags for [identity].
  Future<void> deleteFlags(String identity);

  /// Returns the cached variant definitions for [identity], or `null`.
  Future<TogglyVariantsCache?> readVariants(String identity);

  /// Persists the variant definitions [cache] (keyed by [cache.identity]).
  Future<void> writeVariants(TogglyVariantsCache cache);

  /// Removes any cached variant definitions for [identity].
  Future<void> deleteVariants(String identity);

  /// Returns the cached JWKS JSON string, or `null` if none.
  Future<String?> readJwks();

  /// Persists the JWKS [jwks] JSON string.
  Future<void> writeJwks(String jwks);

  /// Removes any cached JWKS.
  Future<void> deleteJwks();

  /// Returns the sidecar LRU index JSON string, or `null` if missing.
  ///
  /// Shape: `{"entries":{"flags:…":{"lastAccessed":1710000000000}}}`.
  /// Used by [LruTogglyCacheProvider] when `TogglyConfig.maxCacheKeys` is set.
  ///
  /// Official cache providers override this. Custom backends that extend this
  /// class inherit a no-op default (LRU tracking disabled without storage).
  Future<String?> readCacheLruIndex() async => null;

  /// Persists the sidecar LRU index [json] string.
  ///
  /// Official cache providers override this. Custom backends that extend this
  /// class inherit a no-op default.
  Future<void> writeCacheLruIndex(String json) async {}
}

/// Optional extension for [TogglyCacheProvider] implementations that persist
/// the definitions revision (ETag) across app restarts.
///
/// When supplied via [TogglyConfig.cacheProvider], the SDK reads and writes
/// revision through this interface for WebSocket `?rev=` sync and
/// `If-None-Match` conditional fetches. Revisions are scoped per evaluation
/// [identity] (the same context cache key used for flags/variants: user,
/// groups, and claims) so multiple users on one app each retain their own ETag.
///
/// Custom backends should key revisions as
/// `{appKey}:{environment}:{identity}` where [identity] is the SDK context
/// key (e.g. `u:user-1|g:beta|c:role=admin`). On read, implementations may
/// migrate a legacy `{appKey}:{environment}` revision to the identity-scoped
/// key (see official cache packages).
abstract class TogglyRevisionCacheProvider implements TogglyCacheProvider {
  /// Returns the cached definitions revision for [appKey], [environment], and
  /// evaluation [identity].
  Future<String?> readDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  );

  /// Persists [revision] for [appKey], [environment], and evaluation [identity].
  Future<void> writeDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
    String revision,
  );

  /// Removes any cached definitions revision for [appKey], [environment], and
  /// evaluation [identity].
  Future<void> deleteDefinitionsRevision(
    String appKey,
    String environment,
    String identity,
  );
}
