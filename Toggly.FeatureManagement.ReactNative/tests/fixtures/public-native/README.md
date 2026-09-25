# Public React Native telemetry consumer (OPS-1381)

This bare React Native 0.87.1 app installs published npm packages:

- `@ops-ai/react-native-toggly@1.5.0`
- `@ops-ai/react-native-toggly-core@1.9.1` (pulls `@ops-ai/toggly-client-telemetry@^1.1.1`)
- `@ops-ai/react-native-toggly-storage-mmkv4@1.0.0`

plus React Native `0.87.1`, React `19.2.3`, MMKV `4.3.2`, and Nitro `0.37.1`.
The MMKV4 adapter stores definitions/device state only; Core owns the single
in-memory telemetry reporter. The fixture uses sample keys and a loopback
collector only. Do not substitute a production endpoint or real application key.
Stock Hermes is the acceptance host — no `react-native-url-polyfill`.

## Clean JavaScript checks (also hosted CI)

Use Node 22.13+ or 24.3+:

```sh
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
npm run bundle:ios
npm run bundle:android
```

The npm lock must resolve `@ops-ai` packages from `https://registry.npmjs.org/`
with SHA-512 integrities. No workspace aliases, local tarballs, source imports,
forced peers, or `react-native-url-polyfill` appear in the acceptance lock.

Hosted workflow: `.github/workflows/react-native-public-consumer.yml` runs the
checks above on pull requests that touch this fixture. Native Hermes simulator
proof is local (see `EVIDENCE.md`).

## Native run (local Hermes proof)

Start the local collector in a separate terminal:

```sh
node scripts/collector.mjs
```

For iOS (prefer an iOS 18.x simulator; avoid unproven iOS 27 scene templates):

```sh
bundle install
cd ios && bundle exec pod install && cd ..
npm run ios -- --simulator "iPhone 16 Pro"
```

For Android (API 35 emulator):

```sh
adb reverse tcp:8765 tcp:8765
npm run android
```

Keep Hermes and the New Architecture enabled. MMKV4/Nitro require a native
build; Expo Go cannot run this fixture.

The first evaluation runs automatically after the owner initializes; then the
sample clears its instance token, evaluates once, and flushes an identity-only
batch. **Run evaluations and flush** repeats the full evaluation. The screen
should display `direct:true`, `negatedAll:true`, `shortCircuit:false`,
`local:false`, `entity:true`.

On stock Hermes the collector must show:

```text
GET /evaluated-signed/sample-key-a/Acceptance?...
POST /api/frontend/telemetry
```

never bare `GET /` or `POST /`. Compact bodies include `k/e/f/m` (and optional
`i`/`u` as emitted). Forbidden headers `Origin`, `Authorization`, `Cookie`, and
`X-Toggly-Identity` must be absent. No request may reach `metrics.toggly.io`.

The first packet's expected `f` leaves include `DirectOn` enabled twice,
`DirectOff` disabled twice, `LocalOn` disabled once, `OrderGate` enabled once,
and explicit `sample` usage/view counts. `SkippedOn` must be absent because the
gate short circuits. `m` includes `orders:2` and `cart:3.5`; the second packet
has an identity-only `u` and one `DirectOn` check.

Tap **Rotate context and flush** to observe a new context batch. Switch to
**Opt out** or **Keyless**, run again, and verify the collector receives no
telemetry. **Replace owner** changes the app key and retires the old provider.
Send the app to background and resume where practical; Jest covers AppState with
a synthetic subscriber. MMKV should contain only definition/device state, never
a telemetry queue. A successful Metro bundle alone does not prove Hermes
execution or JSI linkage.
