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
  feature_flags_toggly: ^1.9.0
  feature_flags_toggly_secure_storage: ^0.5.0
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
    aOptions: AndroidOptions(resetOnError: false),
  ),
);
```

The provider uses an injected instance unchanged. Its platform options,
namespace, accessibility, and errors remain controlled by the application;
Toggly never resets a failing secure store.

## Supported plugin versions and Android migration

This package supports `flutter_secure_storage` 9, 10, and 11 through their
shared `read`, `write`, and `delete` APIs. Each plugin major has its own
Flutter, Dart, Android, and platform requirements, so applications must use a
Flutter SDK and host configuration supported by the selected plugin release.

For Android data created before plugin v10, ship and run an intermediate v10
application release before upgrading the host to v11. Keep the same application
ID, installed app data, storage namespace/options, and stable Toggly identity.
Do not uninstall the application or clear storage during that migration. A
dependency-range update cannot migrate native encrypted data on its own.

Verify the existing values and restart the v10 application before moving to
v11. Keep the stored Toggly keys unchanged:

- `toggly.flags.<identity>` and `toggly.variants.<identity>`
- `toggly.jwks` and `toggly.cache-lru`
- `toggly.revision.<appKey>:<environment>:<identity>`

The adapter's legacy revision-key migration is separate from the native
plugin's encryption migration. Test customized secure-storage options in the
application that owns them, and consult the
[flutter_secure_storage migration guidance](https://pub.dev/packages/flutter_secure_storage/changelog)
before changing plugin majors.

## Other backends

- [`feature_flags_toggly_disk`](https://pub.dev/packages/feature_flags_toggly_disk) - plain JSON files
- [`feature_flags_toggly_sqlite`](https://pub.dev/packages/feature_flags_toggly_sqlite) - SQLite via `sqflite`
- [`feature_flags_toggly_isar`](https://pub.dev/packages/feature_flags_toggly_isar) - Isar database

## License

BSD-3-Clause. See [LICENSE](LICENSE).
