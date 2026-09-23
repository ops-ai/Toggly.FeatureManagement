# Toggly iOS SDK

Official iOS SDK for [Toggly](https://toggly.io) - Feature Flags & A/B Testing Platform.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## Features

- Pure Swift implementation with async/await
- SwiftUI property wrappers and view modifiers
- UIKit support with extensions
- Combine publishers for reactive patterns
- Offline support with caching
- Real-time updates
- Type-safe API
- Frontend telemetry with explicit usage and app metric APIs

## Frontend telemetry (SDK 1.5.0)

Telemetry is enabled by default when `appKey` is set. Feature checks are counted when the SDK actually evaluates a flag, including the evaluated flags in multi-key gates. Short-circuited keys are not counted. SwiftUI and UIKit integrations count the flag values they evaluate or present. Combine publishers count only values accepted by downstream demand, retaining the evaluated leaves and attribution captured before subscriber callbacks. Views and feature use remain explicit:

```swift
let service = TogglyService(config: TogglyConfig(
    appKey: "YOUR_APP_KEY",
    environment: "Production",
    enableTelemetry: true,                 // Set false to opt out.
    metricsBaseUrl: "https://metrics.toggly.io",
    telemetryFlushIntervalMs: 45_000      // 30_000...60_000; invalid values use 45_000.
))

await service.recordUsage("new-checkout")
await service.recordView("new-checkout", variant: "blue")
await service.incrementCounter("orders", value: 2)
await service.setGauge("cart_total", value: 12.5)
await service.flushTelemetry()             // Await the current best-effort send.

// Forward your app lifecycle from the host; background sends buffered data.
await service.setAppState(.background)
```

The metrics request is separate from definitions requests. Its base URL must be an absolute HTTP(S) URL without credentials, a query, or a fragment; an invalid value disables telemetry. It contains the app key, environment, aggregated feature counts, and app-level metric values. Optional host-supplied `instanceId` is sent as `i`, otherwise the current identity is sent as `u`. Groups, claims, entity context, timestamps, instance names, metric kinds, and definition request headers are excluded. The SDK batches up to 2,000 entries or 256 KiB including buffered JSON and retained accounting keys and sends envelopes no larger than 48 KiB. Ordinary sends use native gzip with plain JSON fallback if compression fails before sending. HTTP 202 acknowledges receipt; it does not prove that identity was accepted. The server application setting for client-generated `u` is off by default. Only 429 and 503 may be retried, at most twice with 30/60-second minimum delays and a five-minute batch lifetime. An ambiguous network or timeout failure is dropped. `dispose()` is terminal and starts at most one plain JSON final envelope without changing its synchronous signature. Existing in-flight work has a five-second request deadline, and retries/timers are cancelled. Accepted events keep their original attribution across identity changes, including retries and cached UI checks.

## Host-minted identity (SDK 1.5.0)

Your trusted backend mints the capability and passes it to the app. The SDK never uses a Backend key or mints tokens.

```swift
let service = TogglyService(config: TogglyConfig(
    appKey: "YOUR_FRONTEND_APP_KEY",
    identity: "user-123",
    instanceId: "TOKEN_FROM_YOUR_BACKEND"
))
await service.initialize()
await service.setIdentity("user-456", instanceId: "REPLACEMENT_TOKEN")
await service.setInstanceId("ROTATED_TOKEN") // Retain current user.
await service.setInstanceId(nil)             // Return to client-identity targeting.
await service.setIdentity(nil)               // Clear token and use stored/generated device identity.
```

`setIdentity(_:)` remains source compatible and clears the old token. For an atomic user/token change use `setIdentity(_:instanceId:)`. When `i` is present, definitions requests omit `u`, groups, and claims; the server resolves targeting from the capability. Without `i`, existing identity/group/claim targeting remains available. Definitions caches, revisions, and pending responses are isolated across token changes. Persistent cache scope uses a token hash rather than storing the capability. Omitted identities retain the existing generated device-ID behavior and are sent as `u` only when no minted capability is present. To keep metrics anonymous, configure `identity: ""` with no token; to disable metrics entirely, use `enableTelemetry: false`.

## Initial targeting context (requires iOS SDK 1.4.0)

These configuration fields require **1.4.0** or later.
Pass known targeting values when creating the service so its first evaluated request already uses the correct user context, without a follow-up identity refresh.

```swift
let service = TogglyService(config: TogglyConfig(
    appKey: "YOUR_APP_KEY",              // Your application in the Toggly dashboard.
    identity: "user-123",                // A stable identifier for the signed-in user.
    groups: ["beta", "subscribers"],     // Memberships used by targeting rules.
    claims: ["plan": "pro", "region": "us"] // String attributes used by targeting rules.
))
await service.initialize()              // Sends the complete context on the first request.
```

Groups are trimmed and blanks omitted; claims with empty names or values are omitted, then types are sorted and limited to 20. Values are copied by Swift value semantics. Empty or omitted groups/claims mean no memberships/attributes. Omitting identity retains stored/generated device identity behavior; an explicit empty identity remains empty. The server splits commas in group values, so use separate group entries rather than a comma inside a group name. These remote targeting attributes are separate from local entity-gate `context` values.

## Requirements

- iOS 14.0+ / macOS 11.0+ / tvOS 14.0+ / watchOS 7.0+
- Swift 5.5+
- Xcode 15.0+

## Installation

### Swift Package Manager

Add the following to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/ops-ai/Toggly.FeatureManagement.git", revision: "ios-sdk-v1.6.1")
]
```

Release tags use the `ios-sdk-v` prefix. Pin the exact signed release with `revision:` after the tag is published; a semantic-version `from:` requirement does not select these prefixed tags. Version 1.5.2 added the root manifest required for Git installation. Existing earlier tags retain their original layout.

Then add the products you need:

```swift
.target(
    name: "YourApp",
    dependencies: [
        .product(name: "TogglyCore", package: "Toggly.FeatureManagement"),
        .product(name: "TogglySwiftUI", package: "Toggly.FeatureManagement"),
        // or TogglyUIKit, TogglyCombine
    ]
)
```

### Xcode

1. File → Add Package Dependencies
2. Enter: `https://github.com/ops-ai/Toggly.FeatureManagement.git`
3. Choose **Commit** and enter the full commit SHA referenced by the published release tag `ios-sdk-v1.6.1`.
4. Select the products you need.

## Packages

| Package | Description |
|---------|-------------|
| **TogglyCore** | Core functionality, storage, and API client |
| **TogglySwiftUI** | SwiftUI property wrappers, view modifiers, and views |
| **TogglyUIKit** | UIKit extensions and view controller support |
| **TogglyCombine** | Combine publishers for reactive patterns |

## Quick Start

### 1. Initialize the SDK

```swift
import TogglyCore

// In your App init or AppDelegate
@main
struct MyApp: App {
    init() {
        Toggly.configure(config: TogglyConfig(
            appKey: "your-app-key",
            environment: "Production"
        ))

        Task {
            await Toggly.shared.initialize()
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

### 2. Use Feature Flags

#### SwiftUI

```swift
import TogglySwiftUI

struct ContentView: View {
    // Property wrapper
    @FeatureFlag("new-feature") var isNewFeatureEnabled

    var body: some View {
        VStack {
            if isNewFeatureEnabled {
                NewFeatureView()
            }

            // View modifier — use negate for the off path
            Button("Beta Feature")
                .featureFlag("beta-feature")

            Button("Legacy Banner")
                .featureFlag("new-checkout", negate: true)

            // Feature view (preferred off path: negate)
            FeatureView("dark-mode") {
                DarkModeSettings()
            }

            FeatureView("maintenance-mode", negate: true) {
                MainContent()
            }

            // Dual-slot else: is Variant-style, not the primary Off API
            FeatureView("experiment") {
                VariantA()
            } else: {
                VariantB()
            }
        }
    }
}
```

### Entity context (per evaluation)

Entity-gated flags fail closed without a context. `setIdentity` remains user targeting;
pass an entity on each read. `registerContext` is local only (no schema PUT).

```swift
Toggly.shared.registerContext("Order") { entity in
    let order = entity as! Order
    return TogglyEntityContext(kind: "Order", key: order.id, attributes: ["Color": order.status])
}

if await Toggly.shared.isEnabled("PresalePhotos", context: order, kind: "Order") {
    showPresalePhotos()
}
```

The `FeatureFlags` snapshot still maps every key to a `Bool`: gated flags are `false`
until you evaluate with context.

#### UIKit

```swift
import TogglyUIKit

class MyViewController: FeatureFlagViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        observeFeature("new-feature")
    }

    override func featureFlagDidChange(_ key: String, isEnabled: Bool) {
        // Update UI based on feature flag
        newFeatureButton.isHidden = !isEnabled
    }
}

// Or use async/await
Task {
    if await FeatureFlagAsync.isEnabled("new-feature") {
        showNewFeature()
    }
}
```

Repeated `observeFeature` or view/control bindings replace the prior observer for that key or binding. Use `stopObservingFeature(_:)` on controllers, `unbindFromFeatureFlag()` to remove a view's visibility and control-enabled bindings, or `unbindEnabledFromFeatureFlag()` to remove only a control's enabled-state binding. Stopping or replacing a binding also invalidates pending asynchronous setup.

#### Combine

```swift
import TogglyCombine

class ViewModel: ObservableObject {
    @Published var isFeatureEnabled = false
    private var cancellables = Set<AnyCancellable>()

    init() {
        TogglyPublishers.featureFlag("new-feature")
            .assign(to: &$isFeatureEnabled)
    }
}
```

## API Reference

### TogglyConfig

```swift
TogglyConfig(
    appKey: String?,           // Your Toggly app key
    environment: String,       // Environment name (default: "Production")
    baseURI: String,           // API base URL (default: Toggly CDN)
    identity: String?,         // User identity for targeting
    featureDefaults: FeatureFlags,  // Default values
    showFeatureDuringEvaluation: Bool,  // Show content during evaluation
    refreshInterval: TimeInterval,  // Auto-refresh interval in seconds
    useSignedDefinitions: Bool,     // Use signed definitions
    connectTimeout: TimeInterval,   // Connection timeout
    requestTimeout: TimeInterval,   // Request timeout
    storage: TogglyStorage?         // Custom storage implementation
    enableTelemetry: Bool,          // Enabled by default when appKey is set
    metricsBaseUrl: String,         // Default: https://metrics.toggly.io
    telemetryFlushIntervalMs: Int,  // Default: 45_000
    onTelemetryDiagnostic: (@Sendable (String) -> Void)? // Status codes only
)
```

### TogglyService

```swift
// Initialize
await Toggly.shared.initialize()

// Check features
await Toggly.shared.isFeatureOn("feature-key")
await Toggly.shared.isFeatureOff("feature-key")

// Feature gates (multiple features)
await Toggly.shared.evaluateFeatureGate(
    featureKeys: ["feature1", "feature2"],
    requirement: .all,  // or .any
    negate: false
)

// Identity
await Toggly.shared.setIdentity("user-123")

// Manual refresh
await Toggly.shared.refresh()

// Explicit telemetry and manual flush
await Toggly.shared.recordUsage("feature-key")
await Toggly.shared.recordView("feature-key")
await Toggly.shared.incrementCounter("orders")
await Toggly.shared.setGauge("cart_total", value: 12.5)
await Toggly.shared.flushTelemetry()

// Events
await Toggly.shared.on { event in
    switch event {
    case .featureChanged(let change):
        print("\(change.featureKey): \(change.newValue)")
    default:
        break
    }
}

// Debug info
let debug = await Toggly.shared.getDebugInfo()
```

### SwiftUI Components

```swift
// Property wrapper
@FeatureFlag("key") var isEnabled: Bool
@FeatureFlag("key", negate: true) var isOff: Bool
@FeatureFlag("key", context: order, kind: "Order") var entityEnabled: Bool

// Feature gate (multiple features)
@FeatureGate(["feature1", "feature2"], requirement: .all) var allEnabled
@FeatureGate(["feature1"], negate: true) var negated

// View modifiers — prefer negate for the off path
.featureFlag("key")                    // Show when enabled
.featureFlag("key", negate: true)      // Show when disabled (preferred)
.featureFlag("key") { fallback }       // Variant-style dual slot

// Views
FeatureView("key") { EnabledContent() }
FeatureView("key", negate: true) { OffPathContent() }
FeatureView("key", context: order, kind: "Order") { EntityContent() }
// Dual-slot else: is Variant-style, not the primary Off API
FeatureView("key") { EnabledContent() } else: { DisabledContent() }
FeatureGateView(["a", "b"], negate: true) { OffPathContent() }
```

### Combine Publishers

```swift
// Feature flag publisher
TogglyPublishers.featureFlag("key")
    .sink { isEnabled in ... }

// Feature gate publisher
TogglyPublishers.featureGate(["f1", "f2"], requirement: .any)
    .sink { isEnabled in ... }

// Event publisher
TogglyPublishers.events()
    .sink { event in ... }

// Feature changed publisher
TogglyPublishers.featureChanged(featureKey: "key")
    .sink { change in ... }
```

## Custom Storage

Implement `TogglyStorage` for custom persistence:

```swift
actor MyCustomStorage: TogglyStorage {
    func get(_ key: String) async -> String? { ... }
    func set(_ key: String, value: String) async { ... }
    func delete(_ key: String) async { ... }
    func clear() async { ... }
}

let config = TogglyConfig(
    appKey: "your-key",
    storage: MyCustomStorage()
)
```

Built-in storage options:
- `MemoryStorage` - In-memory (default)
- `UserDefaultsStorage` - Persistent using UserDefaults

## Testing

```swift
// Use feature defaults for testing
let config = TogglyConfig(
    featureDefaults: [
        "feature1": true,
        "feature2": false
    ]
)
Toggly.configure(config: config)
await Toggly.shared.initialize()

// Reset between tests
Toggly.reset()
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Documentation: [docs.toggly.io](https://docs.toggly.io)
- Issues: [GitHub Issues](https://github.com/ops-ai/Toggly.FeatureManagement/issues)
- Email: support@toggly.io
