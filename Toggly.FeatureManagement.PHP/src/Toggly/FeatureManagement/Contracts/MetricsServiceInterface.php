<?php

namespace Toggly\FeatureManagement\Contracts;

/**
 * Service for collecting and sending custom metrics
 */
interface MetricsServiceInterface
{
    /**
     * Record a measurement (aggregated value over time)
     * @param string $metricKey Name/key of the metric
     * @param float $value Value to add (sum) to the metric
     */
    public function measure(string $metricKey, float $value): void;

    /**
     * Record a measurement with context
     * @param string $metricKey Name/key of the metric
     * @param mixed $context Custom context
     * @param float $value Value to add (sum) to the metric
     */
    public function measureWithContext(string $metricKey, $context, float $value): void;

    /**
     * Record an observation (point-in-time value)
     * @param string $metricKey Name/key of the metric
     * @param float $value Value to record
     */
    public function observe(string $metricKey, float $value): void;

    /**
     * Record an observation with context
     * @param string $metricKey Name/key of the metric
     * @param mixed $context Custom context
     * @param float $value Value to record
     */
    public function observeWithContext(string $metricKey, $context, float $value): void;

    /**
     * Increment a counter
     * @param string $metricKey Name/key of the metric
     * @param float $value Value to add to the counter
     */
    public function incrementCounter(string $metricKey, float $value = 1.0): void;

    /**
     * Increment a counter with context
     * @param string $metricKey Name/key of the metric
     * @param mixed $context Custom context
     * @param float $value Value to add to the counter
     */
    public function incrementCounterWithContext(string $metricKey, $context, float $value = 1.0): void;
}
