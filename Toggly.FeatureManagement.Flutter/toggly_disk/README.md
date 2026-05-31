# feature_flags_toggly_disk

On-disk (plain JSON file) persistence backend for the [Toggly](https://toggly.io)
Flutter SDK ([`feature_flags_toggly`](https://pub.dev/packages/feature_flags_toggly)).

The Toggly SDK is memory-only by default. Add this package to persist feature
flags, variant definitions, and JWKS as JSON files under the app documents
directory so flags survive app restarts and remain available offline.

> This backend is **not encrypted**. If cached payloads must be protected at
> rest, use [`feature_flags_toggly_secure_storage`](https://pub.dev/packages/feature_flags_toggly_secure_storage).

> Offline restart also requires a stable `identity` passed to `Toggly.init` /
> `Toggly.setIdentity`.

## Install

```yaml
dependencies:
  feature_flags_toggly: ^1.2.0
  feature_flags_toggly_disk: ^0.1.0
```

## Usage

```dart
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_disk/feature_flags_toggly_disk.dart';

await Toggly.init(
  appKey: '<your-app-key>',
  environment: 'Production',
  identity: currentUserId,
  config: TogglyConfig(
    cacheProvider: DiskCacheProvider(),
  ),
);
```

Provide a custom directory if you don't want the default app documents location:

```dart
DiskCacheProvider(directory: myDirectory);
```

## Other backends

- [`feature_flags_toggly_secure_storage`](https://pub.dev/packages/feature_flags_toggly_secure_storage) - encrypted secure storage
- [`feature_flags_toggly_sqlite`](https://pub.dev/packages/feature_flags_toggly_sqlite) - SQLite via `sqflite`
- [`feature_flags_toggly_isar`](https://pub.dev/packages/feature_flags_toggly_isar) - Isar database

## License

BSD-3-Clause. See [LICENSE](LICENSE).
