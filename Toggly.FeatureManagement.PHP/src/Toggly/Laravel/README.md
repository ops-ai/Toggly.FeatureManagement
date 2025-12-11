# Toggly Feature Management for Laravel

Laravel integration for Toggly Feature Management.

## Installation

```bash
composer require toggly/feature-management-php
```

## Configuration

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
TOGGLY_SNAPSHOT_PROVIDER=cache
TOGGLY_CACHE_STORE=default
```

4. **Register middleware** in `app/Http/Kernel.php`:

```php
protected $routeMiddleware = [
    // ...
    'feature' => \Toggly\Laravel\Middleware\FeatureGateMiddleware::class,
];
```

5. **Schedule tasks** in `app/Console/Kernel.php`:

```php
protected function schedule(Schedule $schedule)
{
    // Refresh features every 5 minutes
    $schedule->call(function () {
        app(\Toggly\FeatureManagement\Core\FeatureProvider::class)->refreshFeatures();
    })->everyFiveMinutes();

    // Send stats every minute
    $schedule->call(function () {
        app(\Toggly\FeatureManagement\Core\UsageStatsProvider::class)->sendStats();
    })->everyMinute();

    // Send metrics every minute
    $schedule->call(function () {
        app(\Toggly\FeatureManagement\Core\MetricsService::class)->sendMetrics();
    })->everyMinute();
}
```

## Usage

### Using the Facade

```php
use Toggly\Laravel\Facades\Toggly;

// Check if feature is enabled
if (Toggly::isEnabled('new-checkout')) {
    return view('checkout.v2');
}

// With context
$enabled = Toggly::isEnabled('premium-feature', [
    'userId' => $user->id,
    'plan' => $user->plan
]);
```

### Using Dependency Injection

```php
use Toggly\FeatureManagement\Core\FeatureManager;

class MyController
{
    public function __construct(private FeatureManager $featureManager)
    {
    }

    public function index()
    {
        if ($this->featureManager->isEnabled('new-feature')) {
            // Feature is enabled
        }
    }
}
```

### Using Middleware

```php
// In routes/web.php
Route::get('/new-feature', function () {
    return view('new-feature');
})->middleware('feature:new-feature');

// With redirect
Route::get('/premium', function () {
    return view('premium');
})->middleware('feature:premium-feature,/upgrade');
```

### Feature State Change Handlers

```php
use Toggly\FeatureManagement\Contracts\FeatureStateServiceInterface;

$stateService = app(FeatureStateServiceInterface::class);

$id = $stateService->whenFeatureTurnsOn('new-api', function() {
    // Initialize new API
    Artisan::call('api:initialize');
});

// Unregister when done
$stateService->unregisterFeatureStateChange('new-api', $id);
```

### Recording Metrics

```php
use Toggly\FeatureManagement\Contracts\MetricsServiceInterface;

$metrics = app(MetricsServiceInterface::class);

// Record measurement
$metrics->measure('checkout-completed', 125.50);

// Record observation
$metrics->observe('active-users', 1500);

// Increment counter
$metrics->incrementCounter('api-calls', 1);
```

## Snapshot Providers

### Cache Provider

```php
use Toggly\FeatureManagement\Storage\SnapshotProviders\CacheSnapshotProvider;
use Toggly\FeatureManagement\Storage\SnapshotSettings;

// In a service provider
$this->app->singleton(FeatureSnapshotProviderInterface::class, function ($app) {
    return new CacheSnapshotProvider(
        $app->make('cache.store'), // Laravel cache store
        new SnapshotSettings(['document_name' => 'toggly_features']),
        86400 // TTL
    );
});
```

### Database Provider

```php
use Toggly\FeatureManagement\Storage\SnapshotProviders\DatabaseSnapshotProvider;

$this->app->singleton(FeatureSnapshotProviderInterface::class, function ($app) {
    return new DatabaseSnapshotProvider(
        $app->make('db')->connection()->getPdo(),
        new SnapshotSettings(['document_name' => 'toggly_features'])
    );
});
```

## Custom Context Provider

```php
use Toggly\FeatureManagement\Contracts\FeatureContextProviderInterface;

class MyContextProvider implements FeatureContextProviderInterface
{
    public function getContextIdentifier(): ?string
    {
        return auth()->user()?->email;
    }

    // ... implement other methods
}

// Register in service provider
$this->app->singleton(FeatureContextProviderInterface::class, MyContextProvider::class);
```
