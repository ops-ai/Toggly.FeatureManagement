class TogglyConfig {
  final String baseURI;
  final bool reloadOnFeatureFlagValidation;
  final int connectTimeout;
  final int receiveTimeout;
  final int sendTimeout;

  final bool isDebug;

  const TogglyConfig({
    this.baseURI = 'https://client.toggly.io',
    this.reloadOnFeatureFlagValidation = false,
    this.connectTimeout = 10000,
    this.receiveTimeout = 20000,
    this.sendTimeout = 20000,
    this.isDebug = false,
  });
}
