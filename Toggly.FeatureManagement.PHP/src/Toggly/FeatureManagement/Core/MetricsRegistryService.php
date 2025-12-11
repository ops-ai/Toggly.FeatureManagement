<?php

namespace Toggly\FeatureManagement\Core;

/**
 * Registry service for custom metrics sources
 */
class MetricsRegistryService
{
    /**
     * @var array<string, callable> Registered measurement callbacks
     */
    private array $measurementCallbacks = [];

    /**
     * @var array<string, callable> Registered observation callbacks
     */
    private array $observationCallbacks = [];

    /**
     * @var array<string, callable> Registered counter callbacks
     */
    private array $counterCallbacks = [];

    /**
     * Register a callback for measurements
     * @param callable $action Callback that returns array<string, float>
     * @return string Unique ID
     */
    public function registerMeasurements(callable $action): string
    {
        $id = uniqid('', true);
        $this->measurementCallbacks[$id] = $action;
        return $id;
    }

    /**
     * Register a callback for observations
     * @param callable $action Callback that returns array<string, array{0: int, 1: float}>
     * @return string Unique ID
     */
    public function registerObservations(callable $action): string
    {
        $id = uniqid('', true);
        $this->observationCallbacks[$id] = $action;
        return $id;
    }

    /**
     * Register a callback for counters
     * @param callable $action Callback that returns array<string, float>
     * @return string Unique ID
     */
    public function registerCounters(callable $action): string
    {
        $id = uniqid('', true);
        $this->counterCallbacks[$id] = $action;
        return $id;
    }

    /**
     * Unregister a callback
     */
    public function unregisterMetrics(string $id): bool
    {
        $found = false;
        if (isset($this->measurementCallbacks[$id])) {
            unset($this->measurementCallbacks[$id]);
            $found = true;
        }
        if (isset($this->observationCallbacks[$id])) {
            unset($this->observationCallbacks[$id]);
            $found = true;
        }
        if (isset($this->counterCallbacks[$id])) {
            unset($this->counterCallbacks[$id]);
            $found = true;
        }
        return $found;
    }

    /**
     * Get all measurement values
     * @return array<string, float>
     */
    public function getMeasurementValues(): array
    {
        $values = [];
        foreach ($this->measurementCallbacks as $callback) {
            try {
                $result = $callback();
                if (is_array($result)) {
                    $values = array_merge($values, $result);
                }
            } catch (\Exception $e) {
                // Log error but continue
                error_log("Error getting measurement values: " . $e->getMessage());
            }
        }
        return $values;
    }

    /**
     * Get all observation values
     * @return array<string, array{0: int, 1: float}>
     */
    public function getObservationValues(): array
    {
        $values = [];
        foreach ($this->observationCallbacks as $callback) {
            try {
                $result = $callback();
                if (is_array($result)) {
                    $values = array_merge($values, $result);
                }
            } catch (\Exception $e) {
                // Log error but continue
                error_log("Error getting observation values: " . $e->getMessage());
            }
        }
        return $values;
    }

    /**
     * Get all counter values
     * @return array<string, float>
     */
    public function getCounterValues(): array
    {
        $values = [];
        foreach ($this->counterCallbacks as $callback) {
            try {
                $result = $callback();
                if (is_array($result)) {
                    $values = array_merge($values, $result);
                }
            } catch (\Exception $e) {
                // Log error but continue
                error_log("Error getting counter values: " . $e->getMessage());
            }
        }
        return $values;
    }
}
