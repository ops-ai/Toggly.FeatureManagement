<?php

namespace Toggly\FeatureManagement\Contracts;

/**
 * Service for recording feature usage statistics
 */
interface UsageStatsProviderInterface
{
    /**
     * Record a check for the feature being performed
     * @param string $featureKey Name/key of the feature
     * @param bool $allowed Decision to show feature made
     */
    public function recordCheck(string $featureKey, bool $allowed): void;

    /**
     * Record a check for the feature with context
     * @param string $featureKey Name/key of the feature
     * @param mixed $context Custom context
     * @param bool $allowed Decision to show feature made
     */
    public function recordUsageWithContext(string $featureKey, $context, bool $allowed): void;

    /**
     * Record a feature being used
     * @param string $featureKey Name/key of the feature
     */
    public function recordUsage(string $featureKey): void;

    /**
     * Record a feature being used with context
     * @param string $featureKey Name/key of the feature
     * @param mixed $context Custom context
     */
    public function recordUsageWithContext(string $featureKey, $context): void;
}
