# feature_flags_toggly_isar

Isar database persistence backend for the [Toggly](https://toggly.io) Flutter
SDK ([`feature_flags_toggly`](https://pub.dev/packages/feature_flags_toggly)).

The Toggly SDK is memory-only by default. Add this package to persist feature
flags, variant definitions, and JWKS in an
[Isar](https://isar-community.dev) database so flags survive app restarts and
remain available offline.

> This package uses the community-maintained
> [`isar_community`](https://pub.dev/packages/isar_community) fork (the original
> `isar` package is no longer maintained). It is API-compatible with Isar v3.

> Offline restart also requires a stable `identity` passed to `Toggly.init` /
> `Toggly.setIdentity`.

## Install

```yaml
dependencies:
  feature_flags_toggly: ^1.2.0
  feature_flags_toggly_isar: ^0.1.0
```

## Usage

Opening Isar is asynchronous, so create the provider with
`IsarCacheProvider.open()` before initializing Toggly:

```dart
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:feature_flags_toggly_isar/feature_flags_toggly_isar.dart';

final cacheProvider = await IsarCacheProvider.open();

await Toggly.init(
  appKey: '<your-app-key>',
  environment: 'Production',
  identity: currentUserId,
  config: TogglyConfig(
    cacheProvider: cacheProvider,
  ),
);
```

By default the Isar instance is created under the app documents directory; pass
`directory:` to `open()` to choose another location.

## Other backends

- [`feature_flags_toggly_secure_storage`](https://pub.dev/packages/feature_flags_toggly_secure_storage) - encrypted secure storage
- [`feature_flags_toggly_disk`](https://pub.dev/packages/feature_flags_toggly_disk) - plain JSON files
- [`feature_flags_toggly_sqlite`](https://pub.dev/packages/feature_flags_toggly_sqlite) - SQLite via `sqflite`

## License

BSD-3-Clause. See [LICENSE](LICENSE).
