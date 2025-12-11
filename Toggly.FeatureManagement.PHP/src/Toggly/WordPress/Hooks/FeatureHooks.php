<?php

namespace Toggly\WordPress\Hooks;

use Toggly\FeatureManagement\Core\FeatureManager;
use Toggly\FeatureManagement\Core\FeatureProvider;

/**
 * WordPress hooks for feature management
 */
class FeatureHooks
{
    private FeatureManager $featureManager;
    private FeatureProvider $featureProvider;

    public function __construct(FeatureManager $featureManager, FeatureProvider $featureProvider)
    {
        $this->featureManager = $featureManager;
        $this->featureProvider = $featureProvider;
    }

    /**
     * Register all hooks
     */
    public function register(): void
    {
        // Register action hooks for feature state changes
        add_action('toggly_feature_turns_on', [$this, 'onFeatureTurnsOn'], 10, 1);
        add_action('toggly_feature_turns_off', [$this, 'onFeatureTurnsOff'], 10, 1);

        // Register feature state change handlers
        $stateService = $this->featureProvider->getFeatureStateService();
        if ($stateService !== null) {
            // This would need to be implemented in FeatureProvider
            // For now, it's a placeholder
        }

        // Enqueue frontend SDK
        add_action('wp_enqueue_scripts', [$this, 'enqueueFrontendSDK']);

        // Add admin bar integration
        add_action('admin_bar_menu', [$this, 'addAdminBarMenu'], 100);
    }

    /**
     * Handle feature turning on
     */
    public function onFeatureTurnsOn(string $featureKey): void
    {
        do_action('toggly_feature_turns_on', $featureKey);
    }

    /**
     * Handle feature turning off
     */
    public function onFeatureTurnsOff(string $featureKey): void
    {
        do_action('toggly_feature_turns_off', $featureKey);
    }

    /**
     * Enqueue frontend SDK
     */
    public function enqueueFrontendSDK(): void
    {
        $appKey = get_option('toggly_settings')['app_key'] ?? '';
        if (empty($appKey)) {
            return;
        }

        wp_enqueue_script(
            'toggly-ui',
            'https://cdn.toggly.io/toggly-ui.js',
            [],
            '1.0.0',
            true
        );

        // Pass app key to frontend
        wp_localize_script('toggly-ui', 'togglyConfig', [
            'appKey' => $appKey,
        ]);
    }

    /**
     * Add admin bar menu
     */
    public function addAdminBarMenu($wp_admin_bar): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $wp_admin_bar->add_menu([
            'id' => 'toggly',
            'title' => 'Toggly',
            'href' => admin_url('admin.php?page=toggly'),
        ]);

        // Add feature status submenu items
        $definitions = $this->featureProvider->getAllFeatureDefinitions();
        foreach (array_slice($definitions, 0, 5) as $definition) {
            $enabled = $this->featureManager->isEnabled($definition->featureKey);
            $wp_admin_bar->add_menu([
                'parent' => 'toggly',
                'id' => 'toggly-' . $definition->featureKey,
                'title' => $definition->featureKey . ' (' . ($enabled ? 'ON' : 'OFF') . ')',
                'href' => admin_url('admin.php?page=toggly&feature=' . $definition->featureKey),
            ]);
        }
    }
}
