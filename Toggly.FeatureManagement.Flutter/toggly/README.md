Dart package that provides feature flags support for flutter applications allowing you to enable and disable features easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

## What is a Feature Flag

A feature flag (or toggle) in software development provides an alternative to maintaining multiple feature branches in source code. A condition within the code enables or disables a feature during runtime.

In agile settings the feature flag is used in production, to switch on the feature on demand, for some or all the users. Thus, feature flags make it easier to release often. Advanced roll out strategies such as canary roll out and A/B testing are easier to handle.

## Installation

```
$ flutter pub add feature_flags_toggly
```

This will add a line like this to your package's pubspec.yaml (and run an implicit flutter pub get):

```yaml
dependencies:
  feature_flags_toggly: ^0.0.1
```

Alternatively, your editor might support flutter pub get. Check the docs for your editor to learn more.

Now in your Dart code, you can use:

```dart
import 'package:feature_flags_toggly/feature_flags_toggly.dart';
```

## Basic Usage (with Toggly.io)

Initialize Toggly by running the Toggly.init method and by providing your App Key from your [Toggly application page](https://app.toggly.io)

```dart
@override
void initState() {
  initToggly();
  super.initState();
}

void initToggly() async {
  await Toggly.init(
    appKey: '<your_app_key>',
    environment: '<your_app_environment>',
    useSignedDefinitions: true,
    flagDefaults: {
      "ExampleFeatureKey1": true,
      "ExampleFeatureKey2": false,
      "ExampleFeatureKey3": true,
    },
  );
}
```

Now simply wrap your widgets in *Feature* widgets and provide them with the *featureKeys* that best describe them.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

You can also use multiple feature keys for one Feature widget and make use of the *requirement* (FeatureRequirement.all, FeatureRequirement.any) and *negate* (bool) options.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.any,
  child: const Text('This text will show if ANY of the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.all,
  child: const Text('This text will show if ALL the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  negate: true,
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

Lastly, you can also evaluate the value of a Feature gate by calling *evaluateFeatureGate* directly, using the same arguments as for the Feature widget.

```dart
await Toggly.evaluateFeatureGate(
  ["ExampleFeatureKey1", "ExampleFeatureKey2"],
  requirement: FeatureRequirement.all,
  negate: true,
);
```

### Feature vs FeatureGateBuilder

Use **Feature** when you want simple show/hide: the child is rendered when the gate is on, otherwise an empty placeholder is returned.

Use **FeatureGateBuilder** (or **Feature.builder**) when the widget tree stays visible but behavior or styling depends on the gate — for example, disabling link styling and tap handlers while keeping content on screen.

```dart
FeatureGateBuilder(
  featureKeys: const ['PremiumCheckout'],
  builder: (context, premiumCheckoutEnabled) {
    return Text(
      'USDA ID',
      style: TextStyle(
        color: premiumCheckoutEnabled ? Colors.blue : Colors.grey,
        decoration: premiumCheckoutEnabled ? TextDecoration.underline : null,
      ),
    );
  },
)
```

`Feature.builder` uses the same gate resolution (remote flags, local gates, requirement, negate, variant) and is equivalent to wiring your own show/hide via the `enabled` argument.

## Basic Usage (without Toggly.io)

Initialize Toggly by running the Toggly.init method

```dart
@override
void initState() {
  initToggly();
  super.initState();
}

void initToggly() async {
  await Toggly.init(
    flagDefaults: {
      "ExampleFeatureKey1": true,
      "ExampleFeatureKey2": false,
      "ExampleFeatureKey3": true,
    },
  );
}
```

Now simply wrap your widgets in *Feature* widgets and provide them with the *featureKeys* that best describe them.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

You can also use multiple feature keys for one Feature widget and make use of the *requirement* (FeatureRequirement.all, FeatureRequirement.any) and *negate* (bool) options.

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.any,
  child: const Text('This text will show if ANY of the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1', 'ExampleFeatureKey2'],
  requirement: FeatureRequirement.all,
  child: const Text('This text will show if ALL the provided feature keys are TRUE'),
),
```

```dart
Feature(
  featureKeys: const ['ExampleFeatureKey1'],
  negate: true,
  child: const Text('This text will show if ExampleFeatureKey1 is FALSE'),
),
```

Lastly, you can also evaluate the value of a Feature gate by calling *evaluateFeatureGate* directly, using the same arguments as for the Feature widget.

```dart
await Toggly.evaluateFeatureGate(
  ["ExampleFeatureKey1", "ExampleFeatureKey2"],
  requirement: FeatureRequirement.all,
  negate: true,
);
```

## Security

### Signed Definitions

When using Toggly.io, feature flag definitions can be cryptographically signed using ECDSA (ES256) to ensure their authenticity and integrity. This prevents tampering with feature flag values during transmission.

To enable signature verification, set `useSignedDefinitions` to `true` during initialization:

```dart
await Toggly.init(
  appKey: '<your_app_key>',
  environment: '<your_app_environment>',
  useSignedDefinitions: true,
  flagDefaults: {
    "ExampleFeatureKey1": true,
    "ExampleFeatureKey2": false,
  },
);
```

#### How It Works

The signing process uses:
- Curve: P-256 (secp256r1)
- Hash: SHA-256
- Algorithm: ES256 (ECDSA with P-256 and SHA-256)

Each response from the feature flags API includes:
- `data`: The feature flag definitions
- `signature`: A base64-encoded ECDSA signature
- `timestamp`: Unix timestamp when the definitions were signed
- `kid`: Key ID identifying which key was used for signing

The signature is verified using public keys available at the JWKS endpoint (`/.well-known/jwks`). The verification process:
1. Matches the `kid` from the response with the corresponding key in the JWKS
2. Concatenates the JSON data and timestamp with a pipe separator (`data|timestamp`)
3. Hashes the result with SHA-256
4. Verifies the ECDSA signature using the matched public key

Example response:
```json
{
    "data": {
        "FeatureA": true,
        "FeatureB": false
    },
    "signature": "base64_encoded_signature",
    "timestamp": 1234567890,
    "kid": "key1"
}
```

JWKS endpoint response:
```json
{
    "keys": [
        {
            "kty": "EC",
            "use": "sig",
            "kid": "key1",
            "crv": "P-256",
            "x": "base64url_encoded_x_coordinate",
            "y": "base64url_encoded_y_coordinate",
            "alg": "ES256"
        }
    ]
}
```

#### Key Rotation

The JWKS endpoint may contain multiple keys to support key rotation. The client:
1. Caches the JWKS response for up to 30 days
2. Uses the `kid` to select the correct key for verification
3. Refreshes the JWKS cache if a signature uses an unknown key ID

This ensures seamless key rotation without service interruption.

#### Offline Support

The SDK is **memory-only by default** and does not persist anything to disk.
This keeps it crash-safe and avoids secure-storage access while the app is
backgrounded. As a result, a memory-only configuration has no cache after a
cold start and cannot evaluate flags offline until the first successful fetch.

To support offline restarts, supply a **cache provider** — your app chooses
where data is stored. Pass an implementation of `TogglyCacheProvider` via
`TogglyConfig(cacheProvider: ...)`. Offline restart also requires a **stable
identity** passed to `Toggly.init`/`Toggly.setIdentity` (the anonymous
in-memory identity changes on every cold start, so cached entries would not be
found).

```dart
await Toggly.init(
  appKey: '<your-app-key>',
  identity: currentUserId, // stable identity
  config: TogglyConfig(cacheProvider: myCacheProvider),
);
```

Official persistence backends (each published as its own package):

| Package | Backend |
|---------|---------|
| [`feature_flags_toggly_secure_storage`](https://pub.dev/packages/feature_flags_toggly_secure_storage) | Encrypted platform secure storage |
| [`feature_flags_toggly_disk`](https://pub.dev/packages/feature_flags_toggly_disk) | Plain JSON files on disk |
| [`feature_flags_toggly_sqlite`](https://pub.dev/packages/feature_flags_toggly_sqlite) | SQLite via `sqflite` |
| [`feature_flags_toggly_isar`](https://pub.dev/packages/feature_flags_toggly_isar) | Isar database |

Or implement `TogglyCacheProvider` yourself for any other backend.

When a provider is configured and the app is offline, the client:
1. Loads cached flags, variants, and JWKS from the provider
2. Verifies signatures using cached keys (when signed definitions are enabled)
3. Accepts cached feature definitions if verification succeeds
4. Falls back to default values if verification fails

> **Note:** ETags are kept in memory only, so the first request after a cold
> start is always a full fetch (never a `304 Not Modified`).

#### Security Considerations

1. Always use HTTPS in production
2. Monitor logs for signature verification failures
3. Keep your app key secure
4. Consider environment-specific settings

## Find out more about Toggly.io

Visit [our official website](https://toggly.io) or [check out a video overview of our product](https://docs.toggly.io/).
