# Toggly Android SDK

<p align="center">
  <a href="https://search.maven.org/artifact/io.toggly/toggly-android-core"><img src="https://img.shields.io/maven-central/v/io.toggly/toggly-android-core" alt="Maven Central"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

Native Android SDK for [Toggly.io](https://toggly.io) feature flags with Kotlin, coroutines, Jetpack Compose, and traditional Views support.

## Frontend telemetry (1.7.0)

Telemetry is enabled when an application key is configured. Set `enableTelemetry = false` to opt out. Core, Flow, Compose snapshot/entity evaluations, and Views count the feature leaves actually evaluated before aggregate negation; skipped gate keys and internal snapshot projections do not count. Feature use and views remain explicit.

```kotlin
val service = TogglyService(TogglyConfig(
    appKey = "YOUR_APP_KEY",
    enableTelemetry = true,
    metricsBaseUrl = "https://metrics.toggly.io",
    telemetryFlushIntervalMs = 45_000L
))
service.recordUsage("checkout")
service.recordView("checkout", variant = "experiment-a")
service.incrementCounter("orders", 2.0)
service.setGauge("cart_total", 12.5)
service.flushTelemetry() // suspend; await the current best-effort drain

// Forward host lifecycle transitions; background starts a best-effort flush.
service.setAppState(AppStateType.BACKGROUND)
service.dispose() // synchronous; at most one final envelope within five seconds
```

The same explicit APIs are available through `Toggly`, `UseTogglyResult`, `TogglyState`, and `FeatureFlagViewModel`. Telemetry contains the public app key, environment, aggregate feature counts and app-level metric values, plus an optional minted `i` or client `u`. A nonblank `instanceId` takes precedence over `identity`. Without a token, the current identity (including the stored/generated device ID after initialization) is sent as `u`; the application's default-off **Accept client-generated identities for metrics** setting determines whether the server accepts it. HTTP 202 alone does not prove identity attribution. Claims, groups, entity data, and definitions authentication are excluded. Metrics use a separate HTTP client and are never persisted by storage adapters.

Flush intervals outside 30–60 seconds use 45 seconds; each interval has ±20% jitter. Invalid metrics URLs disable telemetry without affecting flag checks. Supply an absolute HTTP(S) base URL without credentials, query or fragment. Ordinary flushes use gzip, with plain JSON fallback only for compression failure before sending. HTTP 202 acknowledges; only explicit 429/503 responses are retried, twice, within five minutes. Ambiguous failures are dropped. Buffers include inflight data and stay within 2,000 entries and 256 KiB, with 48 KiB envelopes. Variant names must be 1–64 ASCII letters, digits, underscores or hyphens. `onTelemetryDiagnostic` receives bounded status codes without event payloads.

## Host-minted identity (1.7.0)

Have your trusted backend mint the token and pass it into `TogglyConfig(instanceId = token, identity = "user-123")`. The Android client never receives a Backend key or calls the mint endpoint. Definitions use `?i=` and omit `u`, `g` and `claim.*` while the token is present; telemetry puts `i` only in the JSON body. Without a token, existing client targeting continues.

```kotlin
service.setIdentity("user-456", replacementToken) // Replace user and token atomically.
service.setInstanceId(rotatedToken)              // Keep the current identity, rotate its token.
service.setInstanceId(null)                      // Clear token, restore client targeting.
service.setIdentity("user-789")                  // Existing API also clears the previous token.
service.setIdentity(null)                        // Return to the stored/generated device ID.
```

These suspend operations return after their serialized context refresh. Core's existing definitions request/cache mutex completes prior work before activating a replacement context. Cache keys and validator reuse are scoped to the effective token or client context; minted cache metadata stores a hash rather than the raw token. Already accepted telemetry keeps its original attribution through retries. One queue retains the global memory/request bounds across rapid changes, and earlier anonymous events are not reassigned during initialization. Explicit flush remains best-effort and cannot guarantee delivery.

The same replacement and rotation operations are forwarded by `Toggly`, `UseTogglyResult`, `TogglyState`, and `FeatureFlagViewModel` (the Views model launches them in its lifecycle scope). Storage companions create no telemetry reporter and persist no telemetry.

## Initial targeting context

These config fields require `io.toggly:toggly-android-core:1.5.0`.
Provide known targeting context before initialization to avoid an intermediate fetch with incomplete targeting:

```kotlin
val service = TogglyService(TogglyConfig(
    appKey = "your-app-key",
    identity = "user-123", // Stable user identifier; omission uses the stored/generated device ID.
    groups = listOf("beta", "engineering"), // Memberships used by targeting rules.
    claims = mapOf("plan" to "pro"), // String attributes used by remote rules.
))
service.init() // Call from a coroutine; the first request includes all three fields.
```

Groups are trimmed and blanks omitted. Claims with empty names or values are omitted;
remaining names are sorted and limited to 20. Explicit empty collections send no targeting
values; an explicit empty identity stays empty. The service snapshots collections at
construction, so later caller mutations do not change targeting. Commas in group names
are interpreted as group separators by the server. Per-call entity `context` remains
separate from these remote groups and claims. Compose, Views and storage integrations
continue to consume the same configuration/service without new APIs.

## Features

- **Kotlin-first**: Built entirely in Kotlin with idiomatic APIs
- **Coroutines & Flow**: Async-first with StateFlow for reactive updates
- **Jetpack Compose**: `Feature`, `FeatureGate`, and `rememberFeature` composables
- **Android Views**: View extensions, LiveData, and ViewModel support
- **Multiple Storage Options**: SharedPreferences, Room, DataStore, or custom
- **Offline Support**: Cached feature flags for offline operation
- **Modular**: Use only what you need

## Modules

| Module | Artifact | Description |
|--------|----------|-------------|
| **Core** | `io.toggly:toggly-android-core` | Core functionality (required) |
| **Compose** | `io.toggly:toggly-compose` | Jetpack Compose support |
| **Views** | `io.toggly:toggly-views` | Android Views, LiveData, ViewModel |
| **Room** | `io.toggly:toggly-room` | Room database storage |
| **DataStore** | `io.toggly:toggly-datastore` | AndroidX DataStore storage |

## Requirements

- Android 7.0+ (API level 24+)
- Kotlin 1.9+
- Java 17+

## Installation

Add the dependencies to your `build.gradle.kts`:

```kotlin
dependencies {
    // Core module (required)
    implementation("io.toggly:toggly-android-core:1.7.0")

    // UI modules (pick what you need)
    implementation("io.toggly:toggly-compose:1.7.0")  // Jetpack Compose
    implementation("io.toggly:toggly-views:1.7.0")    // Android Views

    // Storage modules (pick one, or use built-in SharedPreferences)
    implementation("io.toggly:toggly-room:1.7.0")      // Room database
    implementation("io.toggly:toggly-datastore:1.7.0") // DataStore
}
```

## Quick Start

### Initialize

```kotlin
import io.toggly.core.Toggly
import io.toggly.core.models.TogglyConfig
import io.toggly.core.storage.SharedPreferencesStorage

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        Toggly.configure(
            config = TogglyConfig(
                appKey = "your-app-key",
                environment = "Production"
            ),
            storage = SharedPreferencesStorage(this)
        )

        lifecycleScope.launch {
            Toggly.shared.init()
        }
    }
}
```

### Entity context (per evaluation)

Entity-gated flags fail closed without a context. `setIdentity` remains user targeting;
pass an entity on each read. `registerContext` is local only (no schema PUT).

```kotlin
Toggly.registerContext("Order") { order: Order ->
    TogglyEntityContext(kind = "Order", key = order.id, attributes = mapOf("Color" to order.status))
}

lifecycleScope.launch {
    if (Toggly.isFeatureEnabled("PresalePhotos", order, "Order")) {
        showPresalePhotos()
    }
}
```

The `featureFlags` snapshot still maps every key to a boolean: gated flags are `false`
until you evaluate with context.

### Jetpack Compose

```kotlin
import io.toggly.compose.*

@Composable
fun MyScreen() {
    // Hook-style API
    val isNewDashboard = rememberFeature("new-dashboard")

    if (isNewDashboard) {
        NewDashboardScreen()
    } else {
        LegacyDashboardScreen()
    }
}

// Component-style API — use separate Feature blocks for the on and off paths
@Composable
fun WelcomeSection() {
    Feature("welcome-banner") {
        WelcomeBanner()
    }

    Feature(featureKey = "welcome-banner", negate = true) {
        WelcomePlaceholder()
    }

    // Entity-aware evaluation
    Feature(featureKey = "PresalePhotos", context = order, contextKind = "Order") {
        PresalePhotos()
    }
}

// Feature gates for multiple flags
@Composable
fun AdminSection() {
    FeatureGate(
        featureKeys = listOf("admin-access", "premium-tier"),
        requirement = FeatureRequirement.ALL
    ) {
        AdminPanel()
    }

    FeatureGate(
        featureKeys = listOf("admin-access", "premium-tier"),
        requirement = FeatureRequirement.ALL,
        negate = true
    ) {
        AccessRequest()
    }
}
```

### Android Views

```kotlin
import io.toggly.views.*

class MyActivity : AppCompatActivity() {
    private val viewModel: FeatureFlagViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Bind view visibility to feature flag
        newFeatureButton.bindToFeatureFlag("new-feature", this)

        // Off path: prefer bindToFeatureGate with negate = true
        legacyBanner.bindToFeatureGate(listOf("new-checkout"), this, negate = true)

        // Or use LiveData
        viewModel.featureFlagLiveData("new-dashboard").observe(this) { isEnabled ->
            newDashboardView.visibility = if (isEnabled) View.VISIBLE else View.GONE
        }

        // Toggle between views (Variant-style dual slot)
        toggleViews(
            featureKey = "new-checkout",
            lifecycleOwner = this,
            enabledView = newCheckoutView,
            disabledView = legacyCheckoutView
        )
    }
}
```

### Coroutines & Flow

```kotlin
// Check a feature
val isEnabled = Toggly.shared.isFeatureOn("my-feature")

// Collect feature flag changes
Toggly.shared.featureFlagFlow("my-feature").collect { isEnabled ->
    // React to changes
}

// Feature gate
val hasAccess = Toggly.shared.evaluateFeatureGate(
    featureKeys = listOf("feature-a", "feature-b"),
    requirement = FeatureRequirement.ALL
)
```

## Storage Options

### SharedPreferences (Built-in)
```kotlin
import io.toggly.core.storage.SharedPreferencesStorage
val storage = SharedPreferencesStorage(context)
```

### Room Database
```kotlin
import io.toggly.room.createRoomStorage
val storage = createRoomStorage(context)
```

### DataStore
```kotlin
import io.toggly.datastore.createDataStoreStorage
val storage = createDataStoreStorage(context)
```

### In-Memory (Testing)
```kotlin
import io.toggly.core.storage.MemoryStorage
val storage = MemoryStorage()
```

## Configuration

```kotlin
TogglyConfig(
    appKey = "your-app-key",              // Your Toggly.io app key
    baseUrl = "https://client.toggly.io", // API endpoint (optional)
    environment = "Production",            // Environment name
    defaultFlags = mapOf(                  // Default values
        "feature-a" to true,
        "feature-b" to false
    ),
    refreshInterval = 60_000L,             // Auto-refresh (ms)
    enableAutoRefresh = false,             // Enable auto-refresh
    enableLogging = true                   // Debug logging
)
```

## Identity & Targeting

```kotlin
// Set user identity for targeting
Toggly.shared.setIdentity("user-123")

// Clear identity
Toggly.shared.setIdentity(null)
```

## Events

```kotlin
Toggly.shared.events.collect { event ->
    when (event) {
        is TogglyEvent.Initialized -> { /* Ready */ }
        is TogglyEvent.Refreshed -> { /* Flags updated */ }
        is TogglyEvent.Error -> { /* Handle error */ }
        is TogglyEvent.FeatureChanged -> { /* Flag changed */ }
        // ...
    }
}
```

## Documentation

For detailed documentation, visit [docs.toggly.io/sdks/android](https://docs.toggly.io/sdks/android).

## License

MIT License - see the [LICENSE](../../LICENSE) file for details.

## Support

- [Documentation](https://docs.toggly.io/sdks/android)
- [GitHub Issues](https://github.com/ops-ai/Toggly.FeatureManagement/issues)
- [Email](mailto:support@toggly.io)
