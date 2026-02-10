<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Toggly App Key
    |--------------------------------------------------------------------------
    |
    | Your Toggly App Key. Get it from the App Settings page on toggly.io
    |
    */
    'app_key' => env('TOGGLY_APP_KEY', ''),

    /*
    |--------------------------------------------------------------------------
    | Environment
    |--------------------------------------------------------------------------
    |
    | Name of the environment. Case sensitive.
    |
    */
    'environment' => env('TOGGLY_ENVIRONMENT', 'Production'),

    /*
    |--------------------------------------------------------------------------
    | Base URL
    |--------------------------------------------------------------------------
    |
    | Base URL of the Toggly instance. Leave blank unless you have a reason to change.
    |
    */
    'base_url' => env('TOGGLY_BASE_URL', 'https://app.toggly.io/'),

    /*
    |--------------------------------------------------------------------------
    | Use Signed Definitions
    |--------------------------------------------------------------------------
    |
    | Use signed definitions to get feature updates with signature verification.
    |
    */
    'use_signed_definitions' => env('TOGGLY_USE_SIGNED_DEFINITIONS', false),

    /*
    |--------------------------------------------------------------------------
    | Allowed Key IDs
    |--------------------------------------------------------------------------
    |
    | Whitelist of allowed key IDs for signed definitions (comma-separated).
    |
    */
    'allowed_key_ids' => env('TOGGLY_ALLOWED_KEY_IDS', ''),

    /*
    |--------------------------------------------------------------------------
    | Snapshot Provider
    |--------------------------------------------------------------------------
    |
    | Snapshot provider to use: 'cache', 'database', or 'file'
    |
    */
    'snapshot_provider' => env('TOGGLY_SNAPSHOT_PROVIDER', 'cache'),

    /*
    |--------------------------------------------------------------------------
    | Cache Configuration
    |--------------------------------------------------------------------------
    |
    | Cache-specific settings for the cache snapshot provider.
    |
    */
    'cache' => [
        /*
        |----------------------------------------------------------------------
        | Cache Store
        |----------------------------------------------------------------------
        |
        | Laravel cache store to use for snapshot provider. Set to null to use
        | the default cache store configured in config/cache.php.
        | Respects CACHE_DRIVER environment variable when null.
        |
        */
        'store' => env('TOGGLY_CACHE_STORE', null),

        /*
        |----------------------------------------------------------------------
        | Cache Key Prefix
        |----------------------------------------------------------------------
        |
        | Prefix for all Toggly cache keys. Useful to avoid collisions with
        | other cached data in your application.
        |
        */
        'prefix' => env('TOGGLY_CACHE_PREFIX', 'toggly'),

        /*
        |----------------------------------------------------------------------
        | Cache TTL
        |----------------------------------------------------------------------
        |
        | Time-to-live for cached snapshots in seconds. Set to null to cache
        | forever (until manually invalidated). Default is null (forever).
        |
        */
        'ttl' => env('TOGGLY_CACHE_TTL', null),
    ],

    /*
    |--------------------------------------------------------------------------
    | Refresh Interval
    |--------------------------------------------------------------------------
    |
    | Refresh interval in seconds (default: 300 = 5 minutes).
    |
    */
    'refresh_interval' => env('TOGGLY_REFRESH_INTERVAL', 300),

    /*
    |--------------------------------------------------------------------------
    | App Version
    |--------------------------------------------------------------------------
    |
    | The current version of the application. Used to track deployments.
    |
    */
    'app_version' => env('TOGGLY_APP_VERSION', null),

    /*
    |--------------------------------------------------------------------------
    | Instance Name
    |--------------------------------------------------------------------------
    |
    | Hostname or instance name of the application. Useful in load-balanced setups.
    |
    */
    'instance_name' => env('TOGGLY_INSTANCE_NAME', null),

    /*
    |--------------------------------------------------------------------------
    | Undefined Enabled On Development
    |--------------------------------------------------------------------------
    |
    | Undefined features should be treated as AlwaysOn in development.
    |
    */
    'undefined_enabled_on_development' => env('TOGGLY_UNDEFINED_ENABLED_ON_DEVELOPMENT', false),
];
