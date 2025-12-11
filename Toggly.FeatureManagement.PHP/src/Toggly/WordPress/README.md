# Toggly Feature Management WordPress Plugin

WordPress plugin for Toggly Feature Management.

## Installation

1. **Download or clone** the plugin to `wp-content/plugins/toggly/`

2. **Install dependencies**:

```bash
cd wp-content/plugins/toggly
composer install
```

3. **Activate** the plugin in WordPress admin (Plugins > Installed Plugins)

## Configuration

1. Navigate to **Settings > Toggly** in WordPress admin

2. Configure:
   - **App Key**: Your Toggly App Key from toggly.io
   - **Environment**: Environment name (case sensitive)
   - **Base URL**: Leave blank to use default
   - **Use Signed Definitions**: Enable for signature verification

3. Click **Save Changes**

## Usage

### In Templates

```php
<?php if (toggly_is_enabled('new-header')): ?>
    <?php get_template_part('header', 'new'); ?>
<?php endif; ?>
```

### Shortcode

```
[toggly_feature name="premium-content"]
    <!-- Premium content here -->
[/toggly_feature]
```

### In Functions.php

```php
// Feature state change handlers
add_action('toggly_feature_turns_on', function($featureKey) {
    if ($featureKey === 'new-theme') {
        // Activate new theme
        switch_theme('new-theme');
    }
});

add_action('toggly_feature_turns_off', function($featureKey) {
    if ($featureKey === 'new-theme') {
        // Revert to default theme
        switch_theme('default-theme');
    }
});
```

### Programmatic Usage

```php
$plugin = \Toggly\WordPress\TogglyPlugin::getInstance();

if ($plugin->isEnabled('my-feature')) {
    // Feature is enabled
}
```

## Snapshot Providers

The plugin uses WordPress Transients API by default for snapshot storage. You can configure this in the settings.

## Cron Jobs

The plugin automatically schedules WordPress cron jobs for:
- Feature refresh (every 5 minutes)
- Statistics sending (every minute)
- Metrics sending (every minute)

These run via WordPress's built-in cron system.

## Admin Bar Integration

When logged in as an administrator, you'll see a "Toggly" menu in the admin bar showing the status of your top 5 features.

## Requirements

- WordPress 5.0 or higher
- PHP 7.4 or higher
- Composer (for installation)

## Support

For support, visit [https://toggly.io](https://toggly.io)
