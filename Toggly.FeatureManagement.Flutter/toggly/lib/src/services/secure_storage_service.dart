import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum SecureStorageKeys {
  featureFlagsCache,
}

class TogglyFeatureFlagsCache {
  String identity;
  Map<String, bool> flags = {};

  TogglyFeatureFlagsCache({
    required this.identity,
    required this.flags,
  });

  TogglyFeatureFlagsCache.fromJson(Map<String, dynamic> json)
      : identity = json['identity'],
        flags = json['flags'];

  Map<String, dynamic> toJson() => {
        'identity': identity,
        'flags': flags,
      };
}

class SecureStorageService {
  static final SecureStorageService _instance =
      SecureStorageService._internal();

  late FlutterSecureStorage flutterSecureStorage;

  SecureStorageService._internal() {
    flutterSecureStorage = const FlutterSecureStorage();
  }

  static SecureStorageService get getInstance => _instance;

  Future<void> set({required String key, String? value}) async {
    await flutterSecureStorage.write(key: key, value: value);
  }

  Future<String?> get({required String key}) async {
    return flutterSecureStorage.read(key: key);
  }

  Future<void> delete({required String key}) async {
    return flutterSecureStorage.delete(key: key);
  }
}
