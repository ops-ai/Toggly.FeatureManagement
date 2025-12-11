<?php

namespace Toggly\WordPress\Admin;

/**
 * WordPress admin settings page
 */
class SettingsPage
{
    /**
     * Register settings page
     */
    public function register(): void
    {
        add_action('admin_menu', [$this, 'addAdminMenu']);
        add_action('admin_init', [$this, 'registerSettings']);
    }

    /**
     * Add admin menu
     */
    public function addAdminMenu(): void
    {
        add_options_page(
            'Toggly Settings',
            'Toggly',
            'manage_options',
            'toggly',
            [$this, 'renderSettingsPage']
        );
    }

    /**
     * Register settings
     */
    public function registerSettings(): void
    {
        register_setting('toggly_settings', 'toggly_settings', [$this, 'sanitizeSettings']);

        add_settings_section(
            'toggly_main',
            'Main Settings',
            null,
            'toggly'
        );

        add_settings_field(
            'app_key',
            'App Key',
            [$this, 'renderAppKeyField'],
            'toggly',
            'toggly_main'
        );

        add_settings_field(
            'environment',
            'Environment',
            [$this, 'renderEnvironmentField'],
            'toggly',
            'toggly_main'
        );

        add_settings_field(
            'base_url',
            'Base URL',
            [$this, 'renderBaseUrlField'],
            'toggly',
            'toggly_main'
        );

        add_settings_field(
            'use_signed_definitions',
            'Use Signed Definitions',
            [$this, 'renderSignedDefinitionsField'],
            'toggly',
            'toggly_main'
        );
    }

    /**
     * Render settings page
     */
    public function renderSettingsPage(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        ?>
        <div class="wrap">
            <h1>Toggly Settings</h1>
            <form method="post" action="options.php">
                <?php
                settings_fields('toggly_settings');
                do_settings_sections('toggly');
                submit_button();
                ?>
            </form>
        </div>
        <?php
    }

    /**
     * Render app key field
     */
    public function renderAppKeyField(): void
    {
        $options = get_option('toggly_settings', []);
        $value = $options['app_key'] ?? '';
        ?>
        <input type="text" name="toggly_settings[app_key]" value="<?php echo esc_attr($value); ?>" class="regular-text" />
        <p class="description">Your Toggly App Key from toggly.io</p>
        <?php
    }

    /**
     * Render environment field
     */
    public function renderEnvironmentField(): void
    {
        $options = get_option('toggly_settings', []);
        $value = $options['environment'] ?? 'Production';
        ?>
        <input type="text" name="toggly_settings[environment]" value="<?php echo esc_attr($value); ?>" class="regular-text" />
        <p class="description">Environment name (case sensitive)</p>
        <?php
    }

    /**
     * Render base URL field
     */
    public function renderBaseUrlField(): void
    {
        $options = get_option('toggly_settings', []);
        $value = $options['base_url'] ?? '';
        ?>
        <input type="text" name="toggly_settings[base_url]" value="<?php echo esc_attr($value); ?>" class="regular-text" />
        <p class="description">Leave blank to use default (https://app.toggly.io/)</p>
        <?php
    }

    /**
     * Render signed definitions field
     */
    public function renderSignedDefinitionsField(): void
    {
        $options = get_option('toggly_settings', []);
        $value = $options['use_signed_definitions'] ?? false;
        ?>
        <input type="checkbox" name="toggly_settings[use_signed_definitions]" value="1" <?php checked($value, true); ?> />
        <p class="description">Enable signature verification for feature definitions</p>
        <?php
    }

    /**
     * Sanitize settings
     */
    public function sanitizeSettings(array $input): array
    {
        $sanitized = [];

        if (isset($input['app_key'])) {
            $sanitized['app_key'] = sanitize_text_field($input['app_key']);
        }

        if (isset($input['environment'])) {
            $sanitized['environment'] = sanitize_text_field($input['environment']);
        }

        if (isset($input['base_url'])) {
            $sanitized['base_url'] = esc_url_raw($input['base_url']);
        }

        if (isset($input['use_signed_definitions'])) {
            $sanitized['use_signed_definitions'] = (bool)$input['use_signed_definitions'];
        }

        return $sanitized;
    }
}
