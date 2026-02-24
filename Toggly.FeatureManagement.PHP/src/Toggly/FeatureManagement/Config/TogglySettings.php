<?php

namespace Toggly\FeatureManagement\Config;

/**
 * Configuration settings for Toggly Feature Management
 */
class TogglySettings
{
    /**
     * Toggly App Key. Get it from the App Settings page on toggly.io
     */
    public string $appKey = '';

    /**
     * Name of the environment. Case sensitive
     */
    public string $environment = 'Production';

    /**
     * Use signed definitions to get feature updates
     */
    public bool $useSignedDefinitions = false;

    /**
     * Base URL of the toggly instance. Leave blank unless you have a reason to change
     */
    public ?string $baseUrl = null;

    /**
     * The current version of the application. Used to track deployments
     */
    public ?string $appVersion = null;

    /**
     * Hostname or instance name of the application. Useful in load-balanced and multi-server setups
     */
    public ?string $instanceName = null;

    /**
     * Undefined features should be treated as AlwaysOn on development
     */
    public bool $undefinedEnabledOnDevelopment = false;

    /**
     * Whitelist of allowed key IDs for signed definitions
     * @var string[]|null
     */
    public ?array $allowedKeyIds = null;

    /**
     * Refresh interval in seconds (default: 300 = 5 minutes)
     */
    public int $refreshInterval = 300;

    /**
     * Enable live updates via WebSocket (default: true)
     * Only effective in long-running processes (CLI, Laravel Octane, ReactPHP, etc.)
     * Automatically disabled in PHP-FPM / traditional request-per-process environments
     */
    public bool $enableLiveUpdates = true;

    public function __construct(array $config = [])
    {
        if (isset($config['app_key'])) {
            $this->appKey = $config['app_key'];
        }
        if (isset($config['environment'])) {
            $this->environment = $config['environment'];
        }
        if (isset($config['use_signed_definitions'])) {
            $this->useSignedDefinitions = (bool)$config['use_signed_definitions'];
        }
        if (isset($config['base_url'])) {
            $this->baseUrl = $config['base_url'];
        }
        if (isset($config['app_version'])) {
            $this->appVersion = $config['app_version'];
        }
        if (isset($config['instance_name'])) {
            $this->instanceName = $config['instance_name'];
        }
        if (isset($config['undefined_enabled_on_development'])) {
            $this->undefinedEnabledOnDevelopment = (bool)$config['undefined_enabled_on_development'];
        }
        if (isset($config['allowed_key_ids'])) {
            $this->allowedKeyIds = is_array($config['allowed_key_ids']) 
                ? $config['allowed_key_ids'] 
                : explode(',', $config['allowed_key_ids']);
        }
        if (isset($config['refresh_interval'])) {
            $this->refreshInterval = (int)$config['refresh_interval'];
        }
        if (isset($config['enable_live_updates'])) {
            $this->enableLiveUpdates = (bool)$config['enable_live_updates'];
        }
    }

    /**
     * Get the base URL, defaulting to https://definitions.toggly.io/
     */
    public function getBaseUrl(): string
    {
        return $this->baseUrl ?? 'https://definitions.toggly.io/';
    }
}
