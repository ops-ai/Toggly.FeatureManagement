class TogglyConfig {
  final String baseURI;
  final int connectTimeout;
  final int featureFlagsRefreshInterval;

  const TogglyConfig({
    this.baseURI = 'https://client.toggly.io',
    this.connectTimeout = 5 * 1000,
    this.featureFlagsRefreshInterval = 3 * 60 * 1000,
  });
}
