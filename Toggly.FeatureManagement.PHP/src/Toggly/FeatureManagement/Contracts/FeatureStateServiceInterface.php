<?php

namespace Toggly\FeatureManagement\Contracts;

/**
 * Service to manage feature state change notifications
 */
interface FeatureStateServiceInterface
{
    /**
     * Register a callback to be executed when the feature turns on.
     * @param string|object $featureKey Feature key (string or enum-like object)
     * @param callable $action Action to be executed
     * @return string A unique id representing the callback, which can be used to unregister notifications
     */
    public function whenFeatureTurnsOn($featureKey, callable $action): string;

    /**
     * Register a callback to be executed when the feature turns off.
     * @param string|object $featureKey Feature key (string or enum-like object)
     * @param callable $action Action to be executed
     * @return string A unique id representing the callback, which can be used to unregister notifications
     */
    public function whenFeatureTurnsOff($featureKey, callable $action): string;

    /**
     * Unregister a callback.
     * @param string|object $featureKey Feature key
     * @param string $id The ID of the callback
     * @return bool True if the handler was found and removed
     */
    public function unregisterFeatureStateChange($featureKey, string $id): bool;

    /**
     * Register a callback to be executed when feature definitions change.
     * @param callable $action Action to be executed
     * @return string A unique id representing the callback
     */
    public function whenDefinitionsChange(callable $action): string;

    /**
     * Unregister a definitions change callback.
     * @param string $id The ID of the callback
     * @return bool True if the handler was found and removed
     */
    public function unregisterDefinitionsChange(string $id): bool;
}
