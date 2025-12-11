# Toggly Feature Management for PHP

A comprehensive PHP library for Toggly feature management with native Laravel and WordPress support.

## Features

- **Full Feature Parity**: Matches the functionality of the .NET Toggly.FeatureManagement library
- **Signed Definitions**: ECDSA signature verification for secure feature definitions
- **Real-time Updates**: WebSocket support for instant feature updates (with polling fallback)
- **Usage Statistics**: Automatic tracking of feature usage and user analytics
- **Metrics Collection**: Support for measurements, observations, and counters
- **Snapshot Providers**: Cache, database, and file-based snapshot storage
- **Laravel Integration**: Native Laravel service provider, facade, and middleware
- **WordPress Plugin**: Full WordPress plugin with admin interface and hooks
- **PSR Standards**: Built on PSR-4, PSR-11, PSR-16, PSR-18, and PSR-17

## Installation

### Composer

```bash
composer require toggly/feature-management-php
```

## Quick Start

### Laravel

1. **Register the service provider** in `config/app.php`:

```php
'providers' => [
    // ...
    Toggly\Laravel\ServiceProvider::class,
],
```

2. **Publish the configuration**:

```bash
php artisan vendor:publish --tag=toggly-config
```

3. **Configure** in `.env`:

```env
TOGGLY_APP_KEY=your-app-key
TOGGLY_ENVIRONMENT=Production
TOGGLY_USE_SIGNED_DEFINITIONS=false
```

4. **Use in your code**:

```php
use Toggly\Laravel\Facades\Toggly;

// Check if feature is enabled
if (Toggly::isEnabled('new-checkout')) {
    return view('checkout.v2');
}

// With context
$enabled = Toggly::isEnabledFor('premium-feature', [
    'userId' => $user->id,
    'plan' => $user->plan
]);

// State change handler
Toggly::whenFeatureTurnsOn('new-api', function() {
    // Initialize new API
});

// Record usage
Toggly::recordUsage('feature-key');

// Record metrics
Toggly::measure('checkout-completed', 125.50);
Toggly::observe('active-users', 1500);
Toggly::incrementCounter('api-calls', 1);
```

5. **Use middleware** in routes:

```php
Route::get('/new-feature', function () {
    return view('new-feature');
})->middleware('feature:new-feature');
```

### WordPress

1. **Install the plugin** by copying to `wp-content/plugins/toggly/`

2. **Activate** the plugin in WordPress admin

3. **Configure** in Settings > Toggly:
   - App Key
   - Environment
   - Base URL (optional)
   - Use Signed Definitions (optional)

4. **Use in templates**:

```php
<?php if (toggly_is_enabled('new-header')): ?>
    <?php get_template_part('header', 'new'); ?>
<?php endif; ?>
```

5. **Use shortcode**:

```
[toggly_feature name="premium-content"]
    <!-- Premium content here -->
[/toggly_feature]
```

6. **Use hooks** in `functions.php`:

```php
add_action('toggly_feature_turns_on', function($featureKey) {
    if ($featureKey === 'new-theme') {
        // Activate new theme
    }
});
```

## Core Library Usage

### Basic Usage

```php
use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Core\FeatureProvider;
use Toggly\FeatureManagement\Core\FeatureManager;
use Toggly\FeatureManagement\Http\TogglyHttpClient;

$settings = new TogglySettings([
    'app_key' => 'your-app-key',
    'environment' => 'Production',
]);

$httpClient = new TogglyHttpClient(/* PSR-18 client */, /* PSR-17 factory */, $settings->getBaseUrl());
$featureProvider = new FeatureProvider($settings, $httpClient, /* state service */);
$featureManager = new FeatureManager($featureProvider, /* usage stats */, /* secure provider */);

// Check feature
if ($featureManager->isEnabled('my-feature')) {
    // Feature is enabled
}
```

### Snapshot Providers

#### Cache Provider (PSR-16)

```php
use Toggly\FeatureManagement\Storage\SnapshotProviders\CacheSnapshotProvider;
use Toggly\FeatureManagement\Storage\SnapshotSettings;

$snapshotProvider = new CacheSnapshotProvider(
    $cache, // PSR-16 cache implementation
    new SnapshotSettings(['document_name' => 'toggly_features']),
    86400 // TTL in seconds
);
```

#### Database Provider (PDO)

```php
use Toggly\FeatureManagement\Storage\SnapshotProviders\DatabaseSnapshotProvider;

$snapshotProvider = new DatabaseSnapshotProvider(
    $pdo, // PDO instance
    new SnapshotSettings(['document_name' => 'toggly_features'])
);
```

#### File Provider

```php
use Toggly\FeatureManagement\Storage\SnapshotProviders\FileSnapshotProvider;

$snapshotProvider = new FileSnapshotProvider(
    '/path/to/snapshots',
    new SnapshotSettings(['document_name' => 'toggly_features.json'])
);
```

## Configuration

### TogglySettings

```php
$settings = new TogglySettings([
    'app_key' => 'your-app-key',
    'environment' => 'Production',
    'base_url' => 'https://app.toggly.io/',
    'use_signed_definitions' => true,
    'allowed_key_ids' => ['key-id-1', 'key-id-2'],
    'refresh_interval' => 300, // 5 minutes
    'app_version' => '1.0.0',
    'instance_name' => 'server-1',
    'undefined_enabled_on_development' => false,
]);
```

## Advanced Features

### Feature State Change Handlers

```php
$stateService = $container->get(FeatureStateServiceInterface::class);

// Register callback
$id = $stateService->whenFeatureTurnsOn('new-feature', function() {
    // Initialize feature
});

// Unregister
$stateService->unregisterFeatureStateChange('new-feature', $id);
```

### Custom Metrics

```php
$metricsService = $container->get(MetricsServiceInterface::class);

// Record measurement (aggregated over time)
$metricsService->measure('revenue', 1250.50);

// Record observation (point-in-time)
$metricsService->observe('active-users', 1500);

// Increment counter
$metricsService->incrementCounter('api-calls', 1);
```

### Custom Context Provider

```php
class MyContextProvider implements FeatureContextProviderInterface
{
    public function getContextIdentifier(): ?string
    {
        // Return unique user identifier
        return $this->getCurrentUserId();
    }

    // ... implement other methods
}
```

## Requirements

- PHP 7.4 or higher (8.1+ recommended)
- PSR-18 HTTP client (e.g., Guzzle, Symfony HTTP Client)
- PSR-16 cache (optional, for snapshot provider)
- PSR-11 container (optional, for dependency injection)

## Laravel Requirements

- Laravel 8.0 or higher
- `illuminate/support`
- `illuminate/http`

## WordPress Requirements

- WordPress 5.0 or higher
- No external dependencies (uses WordPress APIs)

## License

MIT

## Architecture

The library follows a modular architecture:

- **Core Library**: Framework-agnostic core functionality
- **Laravel Integration**: Service provider, facade, middleware, and filters
- **WordPress Plugin**: Full plugin with admin interface

### Core Components

- `FeatureProvider`: Fetches and manages feature definitions
- `FeatureManager`: Evaluates features with stats tracking
- `FeatureStateService`: Manages state change notifications
- `UsageStatsProvider`: Collects and sends usage statistics
- `MetricsService`: Collects custom metrics for experiments
- `EcdsaSignatureVerifier`: Verifies signed definitions
- `JwkManager`: Manages JSON Web Keys for signature verification

### Snapshot Providers

Three snapshot provider implementations are available:

1. **CacheSnapshotProvider**: Uses PSR-16 cache (Redis, Memcached, etc.)
2. **DatabaseSnapshotProvider**: Uses PDO (MySQL, PostgreSQL, SQLite)
3. **FileSnapshotProvider**: Uses file system storage

## Development

### Running Tests

```bash
composer test
```

### Code Style

The project follows PSR-12 coding standards.

## Contributing

Contributions are welcome! Please read our contributing guidelines first.

## License

MIT License - see LICENSE file for details.

## Support

For support, visit [https://toggly.io](https://toggly.io) or open an issue on GitHub.
