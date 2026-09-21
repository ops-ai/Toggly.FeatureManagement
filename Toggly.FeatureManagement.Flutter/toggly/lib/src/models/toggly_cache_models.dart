/// Serializable cache models used by [TogglyCacheProvider] implementations to
/// persist feature flags and variant definitions across app restarts.

/// Data representation to be stored in/retrieved from cache.
class TogglyFeatureFlagsCache {
  String identity;
  String flags;
  int? timestamp;
  String? signature;
  String? keyId;

  /// Conditional-fetch metadata bound to this exact response body.
  /// Older records without it remain usable offline but fetch unconditionally.
  String? revision;
  String? appKey;
  String? environment;
  bool? signed;

  TogglyFeatureFlagsCache({
    required this.identity,
    required this.flags,
    required this.timestamp,
    required this.signature,
    required this.keyId,
    this.revision,
    this.appKey,
    this.environment,
    this.signed,
  });

  /// Creates an instance from [json].
  TogglyFeatureFlagsCache.fromJson(Map<String, dynamic> json)
      : identity = json['identity'],
        flags = json['flags'],
        timestamp = json['timestamp'],
        signature = json['signature'],
        keyId = json['keyId'],
        revision = json['revision'],
        appKey = json['appKey'],
        environment = json['environment'],
        signed = json['signed'];

  /// Returns a serializable object.
  Map<String, dynamic> toJson() => {
        'identity': identity,
        'flags': flags,
        'timestamp': timestamp,
        'signature': signature,
        'keyId': keyId,
        'revision': revision,
        'appKey': appKey,
        'environment': environment,
        'signed': signed,
      };
}

/// Serialized variant definitions cache (signed payloads).
class TogglyVariantsCache {
  String identity;
  String variants;
  int? timestamp;
  String? signature;
  String? keyId;

  /// Conditional-fetch metadata bound to this exact response body.
  /// Older records without it remain usable offline but fetch unconditionally.
  String? revision;
  String? appKey;
  String? environment;
  bool? signed;

  TogglyVariantsCache({
    required this.identity,
    required this.variants,
    required this.timestamp,
    required this.signature,
    required this.keyId,
    this.revision,
    this.appKey,
    this.environment,
    this.signed,
  });

  TogglyVariantsCache.fromJson(Map<String, dynamic> json)
      : identity = json['identity'],
        variants = json['variants'],
        timestamp = json['timestamp'],
        signature = json['signature'],
        keyId = json['keyId'],
        revision = json['revision'],
        appKey = json['appKey'],
        environment = json['environment'],
        signed = json['signed'];

  Map<String, dynamic> toJson() => {
        'identity': identity,
        'variants': variants,
        'timestamp': timestamp,
        'signature': signature,
        'keyId': keyId,
        'revision': revision,
        'appKey': appKey,
        'environment': environment,
        'signed': signed,
      };
}
