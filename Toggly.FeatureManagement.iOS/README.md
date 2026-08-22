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

## Requirements

- iOS 14.0+ / macOS 11.0+ / tvOS 14.0+ / watchOS 7.0+
- Swift 5.5+
- Xcode 15.0+

## Installation

### Swift Package Manager

Add the following to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/ops-ai/Toggly.FeatureManagement.git", from: "1.0.0")
]
```

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
3. Select the packages you need

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

            // View modifier
            Button("Beta Feature")
                .featureFlag("beta-feature")

            // Feature view with fallback
            FeatureView("dark-mode") {
                DarkModeSettings()
            } else: {
                Text("Coming soon!")
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
@FeatureFlag("key", defaultValue: true) var isEnabled: Bool

// Feature gate (multiple features)
@FeatureGate(["feature1", "feature2"], requirement: .all) var allEnabled

// View modifiers
.featureFlag("key")           // Show when enabled
.featureFlagOff("key")        // Show when disabled
.featureFlag("key") { fallback }  // With fallback

// Views
FeatureView("key") { EnabledContent() }
FeatureView("key") { EnabledContent() } else: { DisabledContent() }
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
