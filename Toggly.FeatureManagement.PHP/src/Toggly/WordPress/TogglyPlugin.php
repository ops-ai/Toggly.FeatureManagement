<?php

namespace Toggly\WordPress;

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
use Toggly\FeatureManagement\Storage\SnapshotProviders\CacheSnapshotProvider;
use Toggly\FeatureManagement\Storage\SnapshotSettings;
use Toggly\WordPress\Http\WordPressFeatureContextProvider;
use Toggly\WordPress\Hooks\FeatureHooks;

/**
 * Main Toggly WordPress Plugin class
 */
class TogglyPlugin
{
    private static ?TogglyPlugin $instance = null;
    private ?FeatureManager $featureManager = null;
    private ?FeatureProvider $featureProvider = null;
    private ?UsageStatsProvider $usageStatsProvider = null;
    private ?MetricsService $metricsService = null;

    private function __construct()
    {
        // Private constructor for singleton
    }

    /**
     * Get singleton instance
     */
    public static function getInstance(): TogglyPlugin
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Initialize the plugin
     */
    public function init(): void
    {
        // Load settings
        $settings = $this->loadSettings();

        // Initialize core services
        $this->initializeServices($settings);

        // Register hooks
        $this->registerHooks();

        // Register shortcodes
        $this->registerShortcodes();

        // Register template functions
        $this->registerTemplateFunctions();
    }

    /**
     * Load settings from WordPress options
     */
    private function loadSettings(): TogglySettings
    {
        $options = get_option('toggly_settings', []);

        return new TogglySettings([
            'app_key' => $options['app_key'] ?? '',
            'environment' => $options['environment'] ?? 'Production',
            'base_url' => $options['base_url'] ?? null,
            'use_signed_definitions' => $options['use_signed_definitions'] ?? false,
            'allowed_key_ids' => $options['allowed_key_ids'] ?? null,
            'refresh_interval' => $options['refresh_interval'] ?? 300,
            'app_version' => $options['app_version'] ?? null,
            'instance_name' => $options['instance_name'] ?? null,
            'undefined_enabled_on_development' => $options['undefined_enabled_on_development'] ?? false,
        ]);
    }

    /**
     * Initialize core services
     */
    private function initializeServices(TogglySettings $settings): void
    {
        // Create HTTP client (using WordPress HTTP API)
        $httpClient = new TogglyHttpClient(
            new \Toggly\WordPress\Http\WordPressHttpClient(),
            new \Toggly\WordPress\Http\WordPressRequestFactory(),
            $settings->getBaseUrl(),
            'Toggly.FeatureManagement.PHP/1.0'
        );

        // Create snapshot provider
        $snapshotProvider = null;
        $snapshotType = get_option('toggly_snapshot_provider', 'transient');
        if ($snapshotType === 'transient') {
            $snapshotProvider = new CacheSnapshotProvider(
                new \Toggly\WordPress\Storage\WordPressCacheAdapter(),
                new SnapshotSettings(['document_name' => 'toggly_features']),
                86400
            );
        }

        // Create feature state service
        $featureStateService = new FeatureStateService();

        // Create feature provider
        $this->featureProvider = new FeatureProvider(
            $settings,
            $httpClient,
            $featureStateService,
            $snapshotProvider
        );

        // Create context provider
        $contextProvider = new WordPressFeatureContextProvider();

        // Create usage stats provider
        $this->usageStatsProvider = new UsageStatsProvider($settings, $httpClient, $contextProvider);

        // Create metrics registry and service
        $metricsRegistry = new MetricsRegistryService();
        $this->metricsService = new MetricsService($settings, $httpClient, $this->featureProvider, $metricsRegistry);

        // Create feature manager
        $this->featureManager = new FeatureManager(
            $this->featureProvider,
            $this->usageStatsProvider,
            $this->featureProvider, // FeatureProvider implements SecureFeatureProviderInterface
            null // No authorization service by default
        );

        // Schedule cron jobs
        $this->scheduleCronJobs();
    }

    /**
     * Register WordPress hooks
     */
    private function registerHooks(): void
    {
        $hooks = new FeatureHooks($this->featureManager, $this->featureProvider);
        $hooks->register();
    }

    /**
     * Register shortcodes
     */
    private function registerShortcodes(): void
    {
        add_shortcode('toggly_feature', [$this, 'shortcodeTogglyFeature']);
    }

    /**
     * Register template functions
     */
    private function registerTemplateFunctions(): void
    {
        if (!function_exists('toggly_is_enabled')) {
            function toggly_is_enabled(string $featureKey, ?array $context = null): bool
            {
                $plugin = TogglyPlugin::getInstance();
                return $plugin->isEnabled($featureKey, $context);
            }
        }
    }

    /**
     * Shortcode handler for [toggly_feature]
     */
    public function shortcodeTogglyFeature(array $atts, ?string $content = null): string
    {
        $atts = shortcode_atts([
            'name' => '',
            'context' => null,
        ], $atts);

        if (empty($atts['name'])) {
            return '';
        }

        $context = null;
        if ($atts['context'] !== null) {
            $context = json_decode($atts['context'], true);
        }

        if ($this->isEnabled($atts['name'], $context)) {
            return do_shortcode($content ?? '');
        }

        return '';
    }

    /**
     * Check if feature is enabled
     */
    public function isEnabled(string $featureKey, ?array $context = null): bool
    {
        if ($this->featureManager === null) {
            return false;
        }

        return $this->featureManager->isEnabled($featureKey, $context);
    }

    /**
     * Schedule cron jobs for refresh and stats sending
     */
    private function scheduleCronJobs(): void
    {
        // Schedule feature refresh
        if (!wp_next_scheduled('toggly_refresh_features')) {
            wp_schedule_event(time(), 'toggly_refresh_interval', 'toggly_refresh_features');
        }

        add_action('toggly_refresh_features', function () {
            $plugin = TogglyPlugin::getInstance();
            if ($plugin->featureProvider !== null) {
                $plugin->featureProvider->refreshFeatures();
            }
        });

        // Schedule stats sending
        if (!wp_next_scheduled('toggly_send_stats')) {
            wp_schedule_event(time(), 'toggly_send_interval', 'toggly_send_stats');
        }

        add_action('toggly_send_stats', function () {
            $plugin = TogglyPlugin::getInstance();
            if ($plugin->usageStatsProvider !== null) {
                $plugin->usageStatsProvider->sendStats();
            }
            if ($plugin->metricsService !== null) {
                $plugin->metricsService->sendMetrics();
            }
        });

        // Add custom cron intervals
        add_filter('cron_schedules', function ($schedules) {
            $schedules['toggly_refresh_interval'] = [
                'interval' => 300, // 5 minutes
                'display' => 'Every 5 Minutes',
            ];
            $schedules['toggly_send_interval'] = [
                'interval' => 60, // 1 minute
                'display' => 'Every Minute',
            ];
            return $schedules;
        });
    }
}
