/// Serializable cache models used by [TogglyCacheProvider] implementations to
/// persist feature flags and variant definitions across app restarts.

/// Data representation to be stored in/retrieved from cache.
class TogglyFeatureFlagsCache {
  String identity;
  String flags;
  int? timestamp;
  String? signature;
  String? keyId;

  TogglyFeatureFlagsCache({
    required this.identity,
    required this.flags,
    required this.timestamp,
    required this.signature,
    required this.keyId,
  });

  /// Creates an instance from [json].
  TogglyFeatureFlagsCache.fromJson(Map<String, dynamic> json)
      : identity = json['identity'],
        flags = json['flags'],
        timestamp = json['timestamp'],
        signature = json['signature'],
        keyId = json['keyId'];

  /// Returns a serializable object.
  Map<String, dynamic> toJson() => {
        'identity': identity,
        'flags': flags,
        'timestamp': timestamp,
        'signature': signature,
        'keyId': keyId,
      };
}

/// Serialized variant definitions cache (signed payloads).
class TogglyVariantsCache {
  String identity;
  String variants;
  int? timestamp;
  String? signature;
  String? keyId;

  TogglyVariantsCache({
    required this.identity,
    required this.variants,
    required this.timestamp,
    required this.signature,
    required this.keyId,
  });

  TogglyVariantsCache.fromJson(Map<String, dynamic> json)
      : identity = json['identity'],
        variants = json['variants'],
        timestamp = json['timestamp'],
        signature = json['signature'],
        keyId = json['keyId'];

  Map<String, dynamic> toJson() => {
        'identity': identity,
        'variants': variants,
        'timestamp': timestamp,
        'signature': signature,
        'keyId': keyId,
      };
}
