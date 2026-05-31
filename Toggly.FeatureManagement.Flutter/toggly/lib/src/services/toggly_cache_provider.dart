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
}
