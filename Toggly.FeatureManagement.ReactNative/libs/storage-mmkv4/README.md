# @ops-ai/react-native-toggly-storage-mmkv4

MMKV 4 and Nitro storage adapter for the React Native Toggly SDK.

## Install

Install this package with MMKV 4 and Nitro modules:

```bash
npm install @ops-ai/react-native-toggly-storage-mmkv4 react-native-mmkv react-native-nitro-modules
```

MMKV 4 needs a native build. For bare React Native applications, install
CocoaPods after changing native dependencies:

```bash
cd ios && pod install
```

Expo Go cannot load custom native modules. Expo applications need a development
build, and all applications must meet their selected React Native release's
Node, iOS, Android, and Nitro requirements. Package installation and
TypeScript validation do not replace a generated native host build.

## Use

```ts
import { createMMKV4StorageAdapter } from '@ops-ai/react-native-toggly-storage-mmkv4';

const storage = createMMKV4StorageAdapter({
  id: 'toggly',
  keyPrefix: 'toggly:',
  encrypted: true,
  encryptionKey: '0123456789abcdef',
});
```

Pass `storage` to the Toggly client in the same way as other `TogglyStorage`
implementations. The adapter preserves the `toggly:` key prefix and `toggly`
MMKV ID unless you configure different values.

## Migrating from MMKV 2 or 3

MMKV 4 has a different native API, so install this package instead of
`@ops-ai/react-native-toggly-storage-mmkv`. Keep the same `id`, `keyPrefix`,
`path`, and encryption key to preserve Toggly's storage addressing. Verify the
native-store migration on every target device before shipping: this adapter
neither deletes existing data nor copies cache entries between native MMKV
implementations.

If an application constructs its own MMKV 4 instance, provide it directly:

```ts
import { createMMKV } from 'react-native-mmkv';

const storage = createMMKV4StorageAdapter({
  mmkv: createMMKV({ id: 'toggly', encryptionKey: '0123456789abcdef' }),
});
```

## MMKV 2 and 3

Existing applications using MMKV 2 or 3 continue to use
`@ops-ai/react-native-toggly-storage-mmkv`. This package has a distinct import
and does not change the legacy adapter.

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).
