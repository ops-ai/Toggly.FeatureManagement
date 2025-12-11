<?php
/**
 * Plugin Name: Toggly Feature Management
 * Plugin URI: https://toggly.io/
 * Description: Feature flags around anything. A/B test entire features or sections of your website or store.
 * Version: 1.0.0
 * Author: opsAI LLC
 * Author URI: https://ops.ai/
 * License: MIT
 * Text Domain: toggly
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Load Composer autoloader if available
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require_once __DIR__ . '/vendor/autoload.php';
}

// Initialize plugin
add_action('plugins_loaded', function () {
    if (class_exists(\Toggly\WordPress\TogglyPlugin::class)) {
        $plugin = \Toggly\WordPress\TogglyPlugin::getInstance();
        $plugin->init();

        // Register admin settings
        $settingsPage = new \Toggly\WordPress\Admin\SettingsPage();
        $settingsPage->register();
    }
});
