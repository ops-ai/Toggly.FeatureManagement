<?php

namespace Toggly\Laravel;

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider as BaseServiceProvider;
use Toggly\FeatureManagement\Config\TogglySettings;
use Toggly\FeatureManagement\Contracts\FeatureContextProviderInterface;
use Toggly\FeatureManagement\Contracts\FeatureSnapshotProviderInterface;
use Toggly\FeatureManagement\Contracts\FeatureStateServiceInterface;
use Toggly\FeatureManagement\Core\FeatureManager;
use Toggly\FeatureManagement\Core\FeatureProvider;
use Toggly\FeatureManagement\Core\FeatureStateService;
use Toggly\FeatureManagement\Core\MetricsRegistryService;
use Toggly\FeatureManagement\Core\MetricsService;
use Toggly\FeatureManagement\Core\UsageStatsProvider;
use Toggly\FeatureManagement\Http\TogglyHttpClient;
use Toggly\FeatureManagement\Storage\SnapshotProviders\DatabaseSnapshotProvider;
use Toggly\FeatureManagement\Storage\SnapshotProviders\FileSnapshotProvider;
use Toggly\FeatureManagement\Storage\SnapshotSettings;
use Toggly\Laravel\Http\HttpFeatureContextProvider;
use Toggly\Laravel\Storage\LaravelCacheSnapshotProvider;
use Toggly\Laravel\View\Components\Feature as FeatureComponent;

class ServiceProvider extends BaseServiceProvider
{
    /**
     * Register services
     */
    public function register(): void
    {
        // Merge config
        $this->mergeConfigFrom(__DIR__ . '/config/toggly.php', 'toggly');

        // Register settings
        $this->app->singleton(TogglySettings::class, function ($app) {
            return new TogglySettings($app['config']->get('toggly', []));
        });

        // Register HTTP client
        $this->app->singleton(TogglyHttpClient::class, function ($app) {
            $settings = $app->make(TogglySettings::class);
            $httpClient = $app->make(\Psr\Http\Client\ClientInterface::class);
            $requestFactory = $app->make(\Psr\Http\Message\RequestFactoryInterface::class);
            
            return new TogglyHttpClient(
                $httpClient,
                $requestFactory,
                $settings->getBaseUrl(),
                'Toggly.FeatureManagement.PHP/1.0',
                $app->make(\Psr\Log\LoggerInterface::class)
            );
        });

        // Register feature state service
        $this->app->singleton(FeatureStateServiceInterface::class, FeatureStateService::class);
        $this->app->singleton(FeatureStateService::class);

        // Register metrics registry
        $this->app->singleton(MetricsRegistryService::class);

        // Register snapshot provider based on configuration
        $this->registerSnapshotProvider();

        // Register feature provider
        $this->app->singleton(FeatureProvider::class, function ($app) {
            $settings = $app->make(TogglySettings::class);
            $httpClient = $app->make(TogglyHttpClient::class);
            $stateService = $app->make(FeatureStateServiceInterface::class);
            $snapshotProvider = $app->bound(FeatureSnapshotProviderInterface::class)
                ? $app->make(FeatureSnapshotProviderInterface::class)
                : null;
            $logger = $app->make(\Psr\Log\LoggerInterface::class);

            return new FeatureProvider($settings, $httpClient, $stateService, $snapshotProvider, $logger);
        });

        // Register feature manager
        $this->app->singleton(FeatureManager::class, function ($app) {
            $featureProvider = $app->make(FeatureProvider::class);
            $usageStats = $app->make(UsageStatsProvider::class);
            $secureProvider = $app->make(FeatureProvider::class); // FeatureProvider implements SecureFeatureProviderInterface
            $authService = $app->bound(\Toggly\FeatureManagement\Contracts\FeatureAuthorizationServiceInterface::class)
                ? $app->make(\Toggly\FeatureManagement\Contracts\FeatureAuthorizationServiceInterface::class)
                : null;

            return new FeatureManager($featureProvider, $usageStats, $secureProvider, $authService);
        });

        // Register usage stats provider
        $this->app->singleton(UsageStatsProvider::class, function ($app) {
            $settings = $app->make(TogglySettings::class);
            $httpClient = $app->make(TogglyHttpClient::class);
            $contextProvider = $app->bound(FeatureContextProviderInterface::class)
                ? $app->make(FeatureContextProviderInterface::class)
                : null;
            $logger = $app->make(\Psr\Log\LoggerInterface::class);

            return new UsageStatsProvider($settings, $httpClient, $contextProvider, $logger);
        });

        // Register metrics service
        $this->app->singleton(MetricsService::class, function ($app) {
            $settings = $app->make(TogglySettings::class);
            $httpClient = $app->make(TogglyHttpClient::class);
            $featureProvider = $app->make(FeatureProvider::class);
            $metricsRegistry = $app->make(MetricsRegistryService::class);
            $logger = $app->make(\Psr\Log\LoggerInterface::class);

            return new MetricsService($settings, $httpClient, $featureProvider, $metricsRegistry, $logger);
        });

        // Register HTTP context provider
        $this->app->singleton(FeatureContextProviderInterface::class, HttpFeatureContextProvider::class);

        // Register facade
        $this->app->alias(FeatureManager::class, 'toggly');
    }

    /**
     * Bootstrap services
     */
    public function boot(): void
    {
        // Publish config
        $this->publishes([
            __DIR__ . '/config/toggly.php' => config_path('toggly.php'),
        ], 'toggly-config');

        // Publish Blade views
        $this->loadViewsFrom(__DIR__ . '/resources/views', 'toggly');

        // Register Blade component
        Blade::component('feature', FeatureComponent::class);

        // Register Blade directives
        $this->registerBladeDirectives();

        // Note: Scheduling should be done in app/Console/Kernel.php
        // Add these to your schedule method:
        // $schedule->call(function () {
        //     app(FeatureProvider::class)->refreshFeatures();
        // })->everyFiveMinutes();
        // 
        // $schedule->call(function () {
        //     app(UsageStatsProvider::class)->sendStats();
        // })->everyMinute();
        // 
        // $schedule->call(function () {
        //     app(MetricsService::class)->sendMetrics();
        // })->everyMinute();
    }

    /**
     * Register Blade directives for feature flags
     */
    private function registerBladeDirectives(): void
    {
        // @feature directive (if statement style)
        Blade::if('feature', function ($feature, $requirement = 'any') {
            $featureManager = app(FeatureManager::class);
            $context = $this->buildBladeContext();
            
            $features = is_string($feature) ? explode(',', $feature) : (array) $feature;
            $features = array_map('trim', $features);
            $requirement = strtolower($requirement);

            if ($requirement === 'all') {
                // All features must be enabled
                foreach ($features as $feat) {
                    if (!$featureManager->isEnabled($feat, $context)) {
                        return false;
                    }
                }
                return true;
            } else {
                // Any feature must be enabled (default)
                foreach ($features as $feat) {
                    if ($featureManager->isEnabled($feat, $context)) {
                        return true;
                    }
                }
                return false;
            }
        });

        // @unlessfeature directive (opposite of @feature)
        Blade::if('unlessfeature', function ($feature) {
            $featureManager = app(FeatureManager::class);
            $context = $this->buildBladeContext();
            
            $features = is_string($feature) ? explode(',', $feature) : (array) $feature;
            $features = array_map('trim', $features);

            // Return true if NO features are enabled
            foreach ($features as $feat) {
                if ($featureManager->isEnabled($feat, $context)) {
                    return false;
                }
            }
            return true;
        });
    }

    /**
     * Build context for Blade directive evaluation
     */
    private function buildBladeContext(): array
    {
        $context = [];

        if (auth()->check()) {
            $user = auth()->user();
            $context['userId'] = $user->id;
            $context['user_id'] = $user->id;

            // Add groups if available
            if (method_exists($user, 'groups')) {
                $context['groups'] = $user->groups();
            }
        }

        if (request()) {
            $context['ip'] = request()->ip();
        }

        return $context;
    }

    /**
     * Register the snapshot provider based on configuration
     */
    private function registerSnapshotProvider(): void
    {
        $this->app->singleton(FeatureSnapshotProviderInterface::class, function ($app) {
            $provider = $app['config']->get('toggly.snapshot_provider', 'cache');

            return match ($provider) {
                'cache' => $this->createCacheSnapshotProvider($app),
                'database' => $this->createDatabaseSnapshotProvider($app),
                'file' => $this->createFileSnapshotProvider($app),
                default => $this->createCacheSnapshotProvider($app),
            };
        });
    }

    /**
     * Create the Laravel cache snapshot provider
     */
    private function createCacheSnapshotProvider($app): LaravelCacheSnapshotProvider
    {
        $cacheConfig = $app['config']->get('toggly.cache', []);

        return new LaravelCacheSnapshotProvider(
            cache: $app->make(\Illuminate\Contracts\Cache\Factory::class),
            store: $cacheConfig['store'] ?? null,
            prefix: $cacheConfig['prefix'] ?? 'toggly',
            ttl: $cacheConfig['ttl'] ?? null
        );
    }

    /**
     * Create the database snapshot provider
     */
    private function createDatabaseSnapshotProvider($app): DatabaseSnapshotProvider
    {
        return new DatabaseSnapshotProvider(
            pdo: $app->make('db')->connection()->getPdo(),
            settings: new SnapshotSettings()
        );
    }

    /**
     * Create the file snapshot provider
     */
    private function createFileSnapshotProvider($app): FileSnapshotProvider
    {
        return new FileSnapshotProvider(
            directory: storage_path('toggly'),
            settings: new SnapshotSettings()
        );
    }
}
