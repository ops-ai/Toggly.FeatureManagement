class TogglyConfig {
  final String baseURI;
  final bool reloadOnFeatureFlagValidation;
  final int connectTimeout;
  final int featureFlagsRefreshInterval;

  final bool isDebug;

  const TogglyConfig({
    this.baseURI = 'https://client.toggly.io',
    this.reloadOnFeatureFlagValidation = false,
    this.connectTimeout = 5 * 1000,
    this.featureFlagsRefreshInterval = 60 * 1000,
    this.isDebug = false,
  });
}
