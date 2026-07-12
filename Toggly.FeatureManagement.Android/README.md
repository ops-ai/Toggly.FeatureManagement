# Toggly Android SDK

<p align="center">
  <a href="https://search.maven.org/artifact/io.toggly/toggly-android-core"><img src="https://img.shields.io/maven-central/v/io.toggly/toggly-android-core" alt="Maven Central"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

Native Android SDK for [Toggly.io](https://toggly.io) feature flags with Kotlin, coroutines, Jetpack Compose, and traditional Views support.

## Features

- **Kotlin-first**: Built entirely in Kotlin with idiomatic APIs
- **Coroutines & Flow**: Async-first with StateFlow for reactive updates
- **Jetpack Compose**: `FeatureFlag`, `FeatureGate`, and `rememberFeatureFlag` composables
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
    implementation("io.toggly:toggly-android-core:1.0.0")

    // UI modules (pick what you need)
    implementation("io.toggly:toggly-compose:1.0.0")  // Jetpack Compose
    implementation("io.toggly:toggly-views:1.0.0")    // Android Views

    // Storage modules (pick one, or use built-in SharedPreferences)
    implementation("io.toggly:toggly-room:1.0.0")      // Room database
    implementation("io.toggly:toggly-datastore:1.0.0") // DataStore
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

### Jetpack Compose

```kotlin
import io.toggly.compose.*

@Composable
fun MyScreen() {
    // Hook-style API
    val isNewDashboard by rememberFeatureFlag("new-dashboard")

    if (isNewDashboard) {
        NewDashboardScreen()
    } else {
        LegacyDashboardScreen()
    }
}

// Component-style API
@Composable
fun WelcomeSection() {
    FeatureFlag("welcome-banner") {
        WelcomeBanner()
    }

    FeatureFlag(
        featureKey = "new-checkout",
        enabled = { NewCheckoutFlow() },
        disabled = { LegacyCheckoutFlow() }
    )
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

        // Or use LiveData
        viewModel.featureFlagLiveData("new-dashboard").observe(this) { isEnabled ->
            newDashboardView.visibility = if (isEnabled) View.VISIBLE else View.GONE
        }

        // Toggle between views
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
