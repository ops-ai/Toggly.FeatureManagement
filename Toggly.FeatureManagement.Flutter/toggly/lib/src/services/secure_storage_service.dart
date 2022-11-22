import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum SecureStorageKeys {
  featureFlagsCache,
}

/// Data representation to be stored in/retrieved from cache.
class TogglyFeatureFlagsCache {
  String identity;
  Map<String, bool> flags = {};

  TogglyFeatureFlagsCache({
    required this.identity,
    required this.flags,
  });

  /// Creates an instance from [json].
  TogglyFeatureFlagsCache.fromJson(Map<String, dynamic> json)
      : identity = json['identity'],
        flags = json['flags'];

  /// Returns a serializable object.
  Map<String, dynamic> toJson() => {
        'identity': identity,
        'flags': flags,
      };
}

/// Cache service utilising flutter_secure_storage.
class SecureStorageService {
  static final SecureStorageService _instance =
      SecureStorageService._internal();

  late FlutterSecureStorage _flutterSecureStorage;

  SecureStorageService._internal() {
    _flutterSecureStorage = const FlutterSecureStorage();
  }

  /// Returns the [SecureStorageService] singleton instance
  static SecureStorageService get getInstance => _instance;

  /// Stores [value] in cache for the provided [key].
  Future<void> set({required String key, String? value}) async {
    await _flutterSecureStorage.write(key: key, value: value);
  }

  /// Retrieves [value] from cache for the provided [key].
  Future<String?> get({required String key}) async {
    return _flutterSecureStorage.read(key: key);
  }

  /// Clears [key] value from cache.
  Future<void> delete({required String key}) async {
    return _flutterSecureStorage.delete(key: key);
  }
}
