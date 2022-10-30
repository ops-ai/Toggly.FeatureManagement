import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageRepository {
  static final SecureStorageRepository _instance =
      SecureStorageRepository._internal();

  late FlutterSecureStorage flutterSecureStorage;

  SecureStorageRepository._internal() {
    flutterSecureStorage = const FlutterSecureStorage();
  }

  static SecureStorageRepository get getInstance => _instance;

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
