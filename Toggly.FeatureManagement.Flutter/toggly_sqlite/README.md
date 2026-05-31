# feature_flags_toggly_sqlite

SQLite persistence backend for the [Toggly](https://toggly.io) Flutter SDK
([`feature_flags_toggly`](https://pub.dev/packages/feature_flags_toggly)).

The Toggly SDK is memory-only by default. Add this package to persist feature
flags, variant definitions, and JWKS in a SQLite database (via `sqflite`) so
flags survive app restarts and remain available offline.

> Offline restart also requires a stable `identity` passed to `Toggly.init` /
> `Toggly.setIdentity`.

## Install

```yaml
dependencies:
  feature_flags_toggly: ^1.2.0
  feature_flags_toggly_sqlite: ^0.1.0
```

## Usage

```dart
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_sqlite/feature_flags_toggly_sqlite.dart';

await Toggly.init(
  appKey: '<your-app-key>',
  environment: 'Production',
  identity: currentUserId,
  config: TogglyConfig(
    cacheProvider: SqliteCacheProvider(),
  ),
);
```

You can inject a custom `DatabaseFactory` and database path (for example to run
on desktop/test VMs with `sqflite_common_ffi`):

```dart
SqliteCacheProvider(dbFactory: databaseFactoryFfi, path: '/tmp/toggly.db');
```

## Other backends

- [`feature_flags_toggly_secure_storage`](https://pub.dev/packages/feature_flags_toggly_secure_storage) - encrypted secure storage
- [`feature_flags_toggly_disk`](https://pub.dev/packages/feature_flags_toggly_disk) - plain JSON files
- [`feature_flags_toggly_isar`](https://pub.dev/packages/feature_flags_toggly_isar) - Isar database

## License

BSD-3-Clause. See [LICENSE](LICENSE).
