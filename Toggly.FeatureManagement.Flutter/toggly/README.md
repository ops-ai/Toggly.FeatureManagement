Dart package that provides feature flags support for flutter applications allowing you to enable and disable features easily.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://pub.dev/packages/feature_flags_toggly"><img src="https://img.shields.io/pub/v/feature_flags_toggly.svg" alt="pub package"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

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
    // useSignedDefinitions defaults to true (ECDSA-verified definitions)
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

### Frontend telemetry

With an application key, Toggly batches feature checks automatically when a
feature is actually evaluated, including `Feature` widgets and async gate
calls. Evaluations that stop early do not count skipped keys. Calls that only
refresh or cache definitions do not count as checks. Without an application
key, telemetry stays off.

Record usage, views, and business metrics explicitly at the point
where they happen. These methods do not evaluate a feature:

```dart
Toggly.recordUsage('Checkout', 'blue');
Toggly.recordView('Checkout', 'blue');
Toggly.incrementCounter('orders', 1);
Toggly.setGauge('cartValue', 42.5);
await Toggly.flushTelemetry(); // Optional when awaiting a send matters.
```

Telemetry is enabled by default with an application key. To opt out or use a
different metrics host, pass a configuration to `Toggly.init`:

```dart
const TogglyConfig(
  enableTelemetry: false,
  metricsBaseUrl: 'https://metrics.toggly.io',
  telemetryFlushIntervalMs: 45000,
)
```

The flush interval accepts 30000–60000 milliseconds and each scheduled flush
has up to 20% jitter. An invalid interval falls back to 45000 milliseconds;
an invalid metrics URL disables telemetry. Neither setting affects feature
evaluation.

#### Identity and privacy

Telemetry sends the application key, environment, aggregated feature counts,
and numeric metric values. A host-supplied `instanceId` is sent as `i`; otherwise
Toggly sends its current identity as `u`, including the ephemeral device identity
created when no explicit identity is supplied. Groups, claims, entity context,
timestamps, metric kind, and backend credentials are excluded from telemetry.
Browser requests omit cookies and credentials, including for same-origin hosts.

Obtain a minted instance ID from your trusted backend, then pass it to the SDK:

```dart
await Toggly.init(appKey: frontendAppKey, identity: userId, instanceId: token);
await Toggly.setIdentity(nextUserId, instanceId: nextToken); // atomic replacement
await Toggly.setInstanceId(rotatedToken); // same user, new token
await Toggly.setInstanceId(null); // use current client identity
await Toggly.setIdentity(null); // logout: clears token and uses ephemeral identity
```

The public SDK does not mint identities or accept Backend keys. Definitions
requests with `instanceId` use only `i` for targeting and suppress client user,
group, and claim parameters. Without a token, existing identity/groups/claims
targeting remains available. Token rotations isolate definitions caches and
revisions; already accepted telemetry retains its original attribution.
`setContext` preserves an omitted token for groups/claims-only updates; changing
the identity clears the previous token unless a replacement is supplied.

The application's **AcceptClientGeneratedIdentitiesForMetrics** server setting
is off by default and decides whether `u` is accepted. A 202 response does not
prove identity acceptance; unresolved tokens can also be ingested anonymously.
Disable telemetry with `enableTelemetry: false` if reporting is not wanted.

#### Delivery limits

Telemetry is best effort and held in memory. Each JSON envelope is at most
48 KiB, with a combined maximum of 2,000 retained entries and 256 KiB including
attribution, queued batches, and retries. Excess events are dropped. Only one
request runs at a time with a five-second deadline. Only 429 and 503 responses
retry, at most twice after 30/60 seconds (or a longer Retry-After), within five
minutes. Other failures and ambiguous sends are dropped. Ordinary native sends
use gzip; browsers use native CompressionStream when available with a pre-send
plain JSON fallback. Browser hidden/pagehide and disposal sends use plain JSON
and fetch keepalive. Disposal removes listeners and permits at most one final
envelope; it does not guarantee delivery.

### Entity context (per evaluation)

Entity-gated flags fail closed without a context. Identity (`Toggly.init` user id)
is separate; pass an entity on each read. `registerContext` is local only (no schema PUT).

```dart
Toggly.registerContext('Order', (entity) {
  final order = entity as Order;
  return TogglyEntityContext(
    kind: 'Order',
    key: order.id,
    attributes: {'Color': order.status},
  );
});

if (await Toggly.isFeatureOn('PresalePhotos', context: order, kind: 'Order')) {
  // ...
}

Feature(
  featureKeys: const ['PresalePhotos'],
  context: order,
  kind: 'Order',
  child: const PresalePhotosView(),
);
```

The public `Map<String, bool>` snapshot still flattens gated flags to `false` without context.

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

### Live updates

`enableLiveUpdates` defaults to `true` and opens a WebSocket for real-time definition changes. The SDK still performs a **guaranteed first HTTP pull** until a successful sync (`lastSynced` in `Toggly.debug()`). WebSocket connectivity alone does not replace that initial fetch — important on cold starts where the first `refresh()` may be skipped while the app is inactive (common on iOS splash).

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

Signed definitions are **enabled by default**. The SDK verifies ECDSA signatures
on every fetch and when loading flags from a persistence backend. Opt out only
if you intentionally need unsigned definitions:

```dart
await Toggly.init(
  appKey: '<your_app_key>',
  environment: '<your_app_environment>',
  useSignedDefinitions: false, // not recommended for production
  flagDefaults: {
    "ExampleFeatureKey1": true,
    "ExampleFeatureKey2": false,
  },
);
```

Optional hardening via `TogglyConfig`:

```dart
config: TogglyConfig(
  trustedKeyIds: ['TRUSTED_KEY_ID'], // optional allowlist
  jwksCacheDuration: Duration(days: 30), // default; minimum 1 minute
  cacheProvider: SecureStorageCacheProvider(), // re-verified on load
),
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
2. Concatenates the **exact raw** JSON `defs` value and timestamp with a pipe separator (`defs|timestamp`) — never a re-serialized map
3. Digests with **double SHA-256** (`SHA256(SHA256(utf8(...)))`) to match Web Crypto `subtle.sign(ECDSA, SHA-256)` used by Toggly.Definitions
4. Verifies the ECDSA P-256 signature (IEEE P1363 / raw `r||s`) using the matched public key

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

Conditional fetches require a validated cached body for the same application,
environment, identity, and response mode. Flags and variant assignments keep
separate revisions. Custom cache providers should preserve each model's
`revision`, `appKey`, `environment`, and `signed` fields (included by `toJson`)
alongside its body. Older records without these optional fields still provide
offline fallback, but the next refresh fetches a full response.

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
