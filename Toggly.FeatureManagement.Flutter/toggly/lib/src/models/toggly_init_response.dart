/// Possible feature flags values loading responses.
enum TogglyLoadFeatureFlagsResponse {
  /// Fetched from the Toggly.io Client API.
  fetched,

  /// Loaded from the cache.
  cached,

  /// Used the feature flag defaults provided during Toggly.init.
  defaults,

  /// Something, somewhere, went wrong.
  error,
}

/// Toggly initialization response model.
class TogglyInitResponse {
  final TogglyLoadFeatureFlagsResponse status;

  TogglyInitResponse({
    required this.status,
  });
}
