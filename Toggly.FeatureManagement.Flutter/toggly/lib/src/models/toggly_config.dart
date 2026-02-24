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

  /// Whether signatures should be verified on signed responses.
  final bool verifySignatures;

  /// Whether to enable WebSocket-based live updates for feature flags.
  /// When enabled, a WebSocket connection is maintained to receive
  /// real-time flag updates, reducing the need for periodic polling.
  final bool enableLiveUpdates;

  const TogglyConfig({
    this.baseURI = 'https://definitions.toggly.io',
    this.connectTimeout = 5 * 1000,
    this.featureFlagsRefreshInterval = 3 * 60 * 1000,
    this.trustedKeyIds,
    this.verifySignatures = false,
    this.enableLiveUpdates = true,
  });
}
