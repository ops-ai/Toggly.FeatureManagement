enum TogglyLoadFeatureFlagsResponse {
  fetched,
  cached,
  defaults,
  error,
}

class TogglyInitResponse {
  final TogglyLoadFeatureFlagsResponse status;

  TogglyInitResponse({
    required this.status,
  });
}
