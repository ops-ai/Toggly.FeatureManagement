<?php

namespace Toggly\FeatureManagement\Core;

use Toggly\FeatureManagement\Contracts\FeatureStateServiceInterface;

/**
 * Service to manage feature state change notifications
 */
class FeatureStateService implements FeatureStateServiceInterface
{
    /**
     * @var array<string, array<string, callable>> Callbacks for when features turn on
     */
    private array $onSubscribers = [];

    /**
     * @var array<string, array<string, callable>> Callbacks for when features turn off
     */
    private array $offSubscribers = [];

    /**
     * @var array<string, bool> Current state of features
     */
    private array $featureStates = [];

    /**
     * @var array<string, callable> Callbacks for definition changes
     */
    private array $definitionChangeSubscribers = [];

    /**
     * @inheritDoc
     */
    public function whenFeatureTurnsOn($featureKey, callable $action): string
    {
        $key = $this->normalizeFeatureKey($featureKey);

        if (!isset($this->onSubscribers[$key])) {
            $this->onSubscribers[$key] = [];
        }

        $id = uniqid('', true);
        $this->onSubscribers[$key][$id] = $action;

        // Execute immediately if feature is already on
        if (isset($this->featureStates[$key]) && $this->featureStates[$key]) {
            try {
                $action();
            } catch (\Exception $e) {
                // Log error but don't break
                error_log("Error executing feature turn-on callback: " . $e->getMessage());
            }
        }

        return $id;
    }

    /**
     * @inheritDoc
     */
    public function whenFeatureTurnsOff($featureKey, callable $action): string
    {
        $key = $this->normalizeFeatureKey($featureKey);

        if (!isset($this->offSubscribers[$key])) {
            $this->offSubscribers[$key] = [];
        }

        $id = uniqid('', true);
        $this->offSubscribers[$key][$id] = $action;

        // Execute immediately if feature is already off
        if (isset($this->featureStates[$key]) && !$this->featureStates[$key]) {
            try {
                $action();
            } catch (\Exception $e) {
                // Log error but don't break
                error_log("Error executing feature turn-off callback: " . $e->getMessage());
            }
        }

        return $id;
    }

    /**
     * @inheritDoc
     */
    public function unregisterFeatureStateChange($featureKey, string $id): bool
    {
        $key = $this->normalizeFeatureKey($featureKey);

        if (isset($this->offSubscribers[$key][$id])) {
            unset($this->offSubscribers[$key][$id]);
            return true;
        }

        if (isset($this->onSubscribers[$key][$id])) {
            unset($this->onSubscribers[$key][$id]);
            return true;
        }

        return false;
    }

    /**
     * @inheritDoc
     */
    public function whenDefinitionsChange(callable $action): string
    {
        $id = uniqid('', true);
        $this->definitionChangeSubscribers[$id] = $action;
        return $id;
    }

    /**
     * @inheritDoc
     */
    public function unregisterDefinitionsChange(string $id): bool
    {
        if (isset($this->definitionChangeSubscribers[$id])) {
            unset($this->definitionChangeSubscribers[$id]);
            return true;
        }

        return false;
    }

    /**
     * Update the state of a feature (internal method)
     */
    public function updateFeatureState(string $featureKey, bool $state): void
    {
        $key = $this->normalizeFeatureKey($featureKey);

        if (!isset($this->featureStates[$key])) {
            $this->featureStates[$key] = $state;
        } else {
            // Only trigger callbacks if state actually changed
            if ($this->featureStates[$key] === $state) {
                return;
            }

            $this->featureStates[$key] = $state;
        }

        // Trigger callbacks
        if ($state && isset($this->onSubscribers[$key])) {
            foreach ($this->onSubscribers[$key] as $callback) {
                try {
                    $callback();
                } catch (\Exception $e) {
                    // Log error but don't break other subscribers
                    error_log("Error executing feature turn-on callback: " . $e->getMessage());
                }
            }
        } elseif (!$state && isset($this->offSubscribers[$key])) {
            foreach ($this->offSubscribers[$key] as $callback) {
                try {
                    $callback();
                } catch (\Exception $e) {
                    // Log error but don't break other subscribers
                    error_log("Error executing feature turn-off callback: " . $e->getMessage());
                }
            }
        }
    }

    /**
     * Notify subscribers that definitions have changed
     */
    public function notifyDefinitionsChanged(): void
    {
        foreach ($this->definitionChangeSubscribers as $callback) {
            try {
                $callback();
            } catch (\Exception $e) {
                // Log error but don't break other subscribers
                error_log("Error executing definitions change callback: " . $e->getMessage());
            }
        }
    }

    /**
     * Normalize feature key (handle string or enum-like objects)
     */
    private function normalizeFeatureKey($featureKey): string
    {
        if (is_string($featureKey)) {
            return $featureKey;
        }

        if (is_object($featureKey)) {
            // Try to get string representation
            if (method_exists($featureKey, '__toString')) {
                return (string)$featureKey;
            }

            // Try to get name if it's an enum-like object
            if (property_exists($featureKey, 'name')) {
                return $featureKey->name;
            }

            // Try to get value if it's an enum-like object
            if (property_exists($featureKey, 'value')) {
                return (string)$featureKey->value;
            }
        }

        throw new \InvalidArgumentException('Feature key must be a string or enum-like object');
    }
}
