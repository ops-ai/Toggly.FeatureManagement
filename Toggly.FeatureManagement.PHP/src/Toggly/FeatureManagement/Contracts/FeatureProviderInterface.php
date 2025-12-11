<?php

namespace Toggly\FeatureManagement\Contracts;

use Toggly\FeatureManagement\Models\FeatureDefinition;

/**
 * Interface for feature providers
 */
interface FeatureProviderInterface extends IFeatureExperimentProvider
{
    /**
     * Get all feature definitions
     * @return FeatureDefinition[]
     */
    public function getAllFeatureDefinitions(): array;

    /**
     * Get a feature definition by name
     */
    public function getFeatureDefinition(string $featureName): ?FeatureDefinition;
}
