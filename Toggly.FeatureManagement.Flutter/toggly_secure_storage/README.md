# feature_flags_toggly_secure_storage

Secure-storage persistence backend for the [Toggly](https://toggly.io) Flutter SDK
([`feature_flags_toggly`](https://pub.dev/packages/feature_flags_toggly)).

The Toggly SDK is memory-only by default. Add this package to persist feature
flags, variant definitions, and JWKS in the platform secure store (Keychain on
iOS/macOS, Keystore-backed encrypted storage on Android) so flags survive app
restarts and remain available offline.

> Offline restart also requires a stable `identity` passed to `Toggly.init` /
> `Toggly.setIdentity`. The ephemeral in-memory identity changes on every cold
> start, so cached entries would not be found.

## Install

```yaml
dependencies:
  feature_flags_toggly: ^1.2.0
  feature_flags_toggly_secure_storage: ^0.1.0
```

## Usage

```dart
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_secure_storage/feature_flags_toggly_secure_storage.dart';

await Toggly.init(
  appKey: '<your-app-key>',
  environment: 'Production',
  identity: currentUserId, // stable identity for offline restart
  config: TogglyConfig(
    cacheProvider: SecureStorageCacheProvider(),
  ),
);
```

You can inject a configured `FlutterSecureStorage` (for example with custom
Android/iOS options):

```dart
SecureStorageCacheProvider(
  storage: const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  ),
);
```

## Other backends

- [`feature_flags_toggly_disk`](https://pub.dev/packages/feature_flags_toggly_disk) - plain JSON files
- [`feature_flags_toggly_sqlite`](https://pub.dev/packages/feature_flags_toggly_sqlite) - SQLite via `sqflite`
- [`feature_flags_toggly_isar`](https://pub.dev/packages/feature_flags_toggly_isar) - Isar database

## License

BSD-3-Clause. See [LICENSE](LICENSE).
