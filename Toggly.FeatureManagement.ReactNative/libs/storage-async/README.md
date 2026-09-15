# @ops-ai/react-native-toggly-storage-async

AsyncStorage adapter for React Native Toggly SDK. It uses the retained default
singleton from `@react-native-async-storage/async-storage` and preserves the
existing `@toggly:` cache-key format.

## Install

```bash
npm install @ops-ai/react-native-toggly-storage-async @react-native-async-storage/async-storage
```

Pass `createAsyncStorageAdapter()` to `TogglyProvider` as the SDK storage
implementation. The adapter uses the default AsyncStorage export; applications
do not need to migrate to a new instance API.

## Supported hosts

The adapter's peer accepts AsyncStorage 1.17 and newer. Packed-consumer checks
cover these valid host combinations:

| Host | React Native | React | AsyncStorage |
| --- | --- | --- | --- |
| Retained React Native host | 0.76.2 | 18.3.1 | 1.24.0 |
| Expo SDK 57 app | 0.86.3 | 19.2.3 | 2.2.0 |
| Current bare React Native app | 0.87.1 | 19.2.3 | 3.1.1 |

Use `npx expo install @react-native-async-storage/async-storage` in an Expo
application so Expo selects its compatible native module version. For bare
React Native, install the peer with the adapter and run the platform-native
dependency steps (`pod install` for iOS and a normal Android build). React
Native 0.87 requires Node 22.13 or newer; follow the selected host release's
Node and React requirements for older retained combinations.

## Migration and persistence

AsyncStorage 1, 2, and 3 continue to export the default singleton used here.
Keep the default `@toggly:` prefix to retain cached Toggly definitions across
the dependency upgrade. This adapter does not delete, rename, or transform
existing application storage keys.

## Documentation

- [docs.toggly.io](https://docs.toggly.io)
- SDK catalog: [root README](../../../README.md)

## License

[MIT](LICENSE) — see also the [repository LICENSE](https://github.com/ops-ai/Toggly.FeatureManagement/blob/develop/LICENSE).

## Issues

Use the [structured issue templates](https://github.com/ops-ai/Toggly.FeatureManagement/issues/new/choose).
