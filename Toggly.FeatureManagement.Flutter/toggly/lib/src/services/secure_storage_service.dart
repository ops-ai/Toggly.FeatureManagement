import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum SecureStorageKeys {
  featureFlagsCache,
  deviceId,
  jwks,
  etag,
}

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

/// Cache service utilising flutter_secure_storage.
class SecureStorageService with WidgetsBindingObserver {
  static final SecureStorageService _instance =
      SecureStorageService._internal();

  late FlutterSecureStorage _flutterSecureStorage;
  bool _isAppInForeground = true;

  SecureStorageService._internal() {
    _flutterSecureStorage = const FlutterSecureStorage();
    // Register for lifecycle events
    WidgetsBinding.instance.addObserver(this);
    _isAppInForeground =
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _isAppInForeground = state == AppLifecycleState.resumed;
  }

  /// Returns the [SecureStorageService] singleton instance
  static SecureStorageService get getInstance => _instance;

  /// Stores [value] in cache for the provided [key].
  Future<void> set({required String key, String? value}) async {
    if (!_isAppInForeground) {
      if (kDebugMode) {
        print('Skipping secure storage write as app is not in foreground');
      }
      return;
    }
    try {
      await _flutterSecureStorage.write(key: key, value: value);
    } catch (e) {
      if (kDebugMode) {
        print('Error writing to secure storage: $e');
      }
      // Silently fail in background state
      if (_isAppInForeground) {
        rethrow;
      }
    }
  }

  /// Retrieves [value] from cache for the provided [key].
  Future<String?> get({required String key}) async {
    if (!_isAppInForeground) {
      if (kDebugMode) {
        print('Skipping secure storage read as app is not in foreground');
      }
      return null;
    }
    try {
      return await _flutterSecureStorage.read(key: key);
    } catch (e) {
      if (kDebugMode) {
        print('Error reading from secure storage: $e');
      }
      // Silently fail in background state
      if (_isAppInForeground) {
        rethrow;
      }
      return null;
    }
  }

  /// Clears [key] value from cache.
  Future<void> delete({required String key}) async {
    if (!_isAppInForeground) {
      if (kDebugMode) {
        print('Skipping secure storage delete as app is not in foreground');
      }
      return;
    }
    try {
      return await _flutterSecureStorage.delete(key: key);
    } catch (e) {
      if (kDebugMode) {
        print('Error deleting from secure storage: $e');
      }
      // Silently fail in background state
      if (_isAppInForeground) {
        rethrow;
      }
    }
  }

  /// Dispose of the observer
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
  }
}
