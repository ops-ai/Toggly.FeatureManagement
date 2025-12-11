<?php

namespace Toggly\FeatureManagement\Contracts;

/**
 * Provides context information for feature evaluation and statistics
 */
interface FeatureContextProviderInterface
{
    /**
     * Store a value tracking the current already recorded usage of this feature
     * @param string $featureName Name of the feature being checked
     * @return bool true if the feature was already counted in the current request or false
     *              if it's the first time the feature is checked in the current request
     */
    public function accessedInRequest(string $featureName): bool;

    /**
     * Store a value tracking the current already recorded usage of this feature with context
     * @param string $featureName Name of the feature being checked
     * @param mixed $context Custom context
     * @return bool true if the feature was already counted in the current request or false
     *              if it's the first time the feature is checked in the current request
     */
    public function accessedInRequestWithContext(string $featureName, $context): bool;

    /**
     * Get the unique identifier being tracked. Ex: Username, IP Address
     * @return string|null
     */
    public function getContextIdentifier(): ?string;

    /**
     * Get the unique identifier being tracked with context
     * @param mixed $context Custom context
     * @return string|null
     */
    public function getContextIdentifierWithContext($context): ?string;
}
