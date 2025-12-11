# Quick Start Guide

## Installation

```bash
composer require toggly/feature-management-php
```

## Laravel Quick Start

1. **Register Service Provider** in `config/app.php`:
```php
'providers' => [
    Toggly\Laravel\ServiceProvider::class,
],
```

2. **Publish Config**:
```bash
php artisan vendor:publish --tag=toggly-config
```

3. **Configure** `.env`:
```env
TOGGLY_APP_KEY=your-app-key
TOGGLY_ENVIRONMENT=Production
```

4. **Use in Code**:
```php
use Toggly\Laravel\Facades\Toggly;

if (Toggly::isEnabled('my-feature')) {
    // Feature is enabled
}
```

5. **Add Scheduling** in `app/Console/Kernel.php`:
```php
protected function schedule(Schedule $schedule)
{
    $schedule->call(function () {
        app(\Toggly\FeatureManagement\Core\FeatureProvider::class)->refreshFeatures();
    })->everyFiveMinutes();
    
    $schedule->call(function () {
        app(\Toggly\FeatureManagement\Core\UsageStatsProvider::class)->sendStats();
    })->everyMinute();
    
    $schedule->call(function () {
        app(\Toggly\FeatureManagement\Core\MetricsService::class)->sendMetrics();
    })->everyMinute();
}
```

## WordPress Quick Start

1. **Copy plugin** to `wp-content/plugins/toggly/`

2. **Install dependencies**:
```bash
cd wp-content/plugins/toggly
composer install
```

3. **Activate** plugin in WordPress admin

4. **Configure** in Settings > Toggly

5. **Use in templates**:
```php
<?php if (toggly_is_enabled('my-feature')): ?>
    <!-- Feature content -->
<?php endif; ?>
```

## Core Library Usage

```php
use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Core\FeatureProvider;
use Toggly\FeatureManagement\Core\FeatureManager;
use Toggly\FeatureManagement\Http\TogglyHttpClient;

// Setup
$settings = new TogglySettings(['app_key' => 'key', 'environment' => 'Production']);
$httpClient = new TogglyHttpClient(/* PSR-18 client */, /* PSR-17 factory */, $settings->getBaseUrl());
$featureProvider = new FeatureProvider($settings, $httpClient, /* state service */);
$featureManager = new FeatureManager($featureProvider, /* usage stats */, /* secure provider */);

// Use
if ($featureManager->isEnabled('my-feature')) {
    // Feature enabled
}
```

## Next Steps

- Read the [README.md](README.md) for detailed documentation
- Check [IMPLEMENTATION.md](IMPLEMENTATION.md) for architecture details
- See Laravel README: `src/Toggly/Laravel/README.md`
- See WordPress README: `src/Toggly/WordPress/README.md`
