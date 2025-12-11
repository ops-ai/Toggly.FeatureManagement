<?php

namespace Toggly\FeatureManagement\Contracts;

use Toggly\FeatureManagement\Models\FeatureDefinition;

/**
 * Interface for feature experiment providers
 * Extends FeatureProviderInterface with experiment-related methods
 */
interface IFeatureExperimentProvider
{
    /**
     * Get features related to a metric for an experiment
     * @return string[]|null
     */
    public function getFeaturesForMetric(string $metricKey): ?array;
}
